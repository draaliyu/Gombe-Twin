from __future__ import annotations

import asyncio
import contextlib
import logging
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.models import TelemetryFrame
from app.services.air_quality import OpenAQService
from app.services.boundary import (
    FALLBACK_GOMBE,
    FALLBACK_GOMBE_LGAS,
    fetch_gombe_boundary,
    fetch_gombe_lgas,
)
from app.services.firms import FirmsService
from app.services.simulator import DigitalTwinSimulator
from app.services.weather import WeatherService


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("gombe-air-quality-twin")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
settings = get_settings()


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self.connections.discard(websocket)

    async def broadcast(self, frame: TelemetryFrame) -> None:
        stale: list[WebSocket] = []
        payload = frame.model_dump_json()
        for websocket in tuple(self.connections):
            try:
                await websocket.send_text(payload)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            self.disconnect(websocket)


manager = ConnectionManager()
simulator = DigitalTwinSimulator(settings)
latest_frame = simulator.next_frame(0)
boundary_cache: dict[str, Any] | None = FALLBACK_GOMBE
lga_cache: dict[str, Any] | None = FALLBACK_GOMBE_LGAS
background_tasks: list[asyncio.Task] = []


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    global background_tasks, boundary_cache, lga_cache
    client = httpx.AsyncClient(timeout=20.0, follow_redirects=True)
    weather_service = WeatherService(settings, client)
    air_service = OpenAQService(settings, client)
    firms_service = FirmsService(settings, client)

    background_tasks = [
        asyncio.create_task(_load_geography(client)),
        asyncio.create_task(_refresh_loop("weather", weather_service.fetch, settings.weather_refresh_seconds)),
        asyncio.create_task(_refresh_loop("air_quality", air_service.fetch, settings.air_quality_refresh_seconds)),
        asyncio.create_task(_refresh_loop("firms", firms_service.fetch, settings.firms_refresh_seconds)),
        asyncio.create_task(_broadcast_loop()),
    ]
    try:
        yield
    finally:
        for task in background_tasks:
            task.cancel()
        await asyncio.gather(*background_tasks, return_exceptions=True)
        await client.aclose()


app = FastAPI(
    title="Gombe State Air Quality Visualisation Twin",
    version="8.0.0",
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def disable_frontend_cache(request, call_next):
    response = await call_next(request)
    if request.url.path in {"/", "/favicon.ico"} or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


async def _load_geography(client: httpx.AsyncClient) -> None:
    global boundary_cache, lga_cache
    try:
        boundary_cache = await fetch_gombe_boundary(client)
        logger.info("Loaded Gombe State administrative boundary")
        lga_cache = await fetch_gombe_lgas(client, boundary_cache)
        logger.info("Loaded %s Gombe LGA features", len(lga_cache.get("features", [])))
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("Geography refresh failed; using fallback geometry: %s", exc)
        boundary_cache = boundary_cache or FALLBACK_GOMBE
        lga_cache = lga_cache or FALLBACK_GOMBE_LGAS


async def _refresh_loop(name: str, fetcher, interval_seconds: int) -> None:
    while True:
        try:
            result = await fetcher()
            if name == "weather":
                simulator.apply_weather(result)
            elif name == "air_quality":
                simulator.apply_air_quality(result)
            elif name == "firms":
                simulator.apply_hotspots(result)
            logger.info("Refreshed %s source", name)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("%s refresh failed; retaining previous/fallback state: %s", name, exc)
        await asyncio.sleep(interval_seconds)


async def _broadcast_loop() -> None:
    global latest_frame
    while True:
        latest_frame = simulator.next_frame(len(manager.connections))
        await manager.broadcast(latest_frame)
        await asyncio.sleep(settings.broadcast_interval_seconds)


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> FileResponse:
    return FileResponse(STATIC_DIR / "favicon.svg", media_type="image/svg+xml")


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "mode": latest_frame.mode,
        "sequence": latest_frame.sequence,
        "connected_clients": len(manager.connections),
    }


@app.get("/api/snapshot", response_model=TelemetryFrame)
async def snapshot() -> TelemetryFrame:
    return latest_frame


@app.get("/api/boundary")
async def boundary() -> JSONResponse:
    return JSONResponse(boundary_cache or {"type": "FeatureCollection", "features": []})


@app.get("/api/lgas")
async def lgas() -> JSONResponse:
    return JSONResponse(lga_cache or FALLBACK_GOMBE_LGAS)


@app.websocket("/ws/live")
async def live_socket(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        await websocket.send_text(latest_frame.model_dump_json())
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
