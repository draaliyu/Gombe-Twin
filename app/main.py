from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import httpx
from fastapi import FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
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
from app.services.forecast import EnvironmentalForecastService
from app.services.history import ObservationStore
from app.services.heat_insights import build_heat_region_insight, build_heat_regions, build_heat_summary
from app.services.insights import build_region_insight
from app.services.prediction import AirQualityPredictor
from app.services.security import AdminGuard
from app.services.simulator import DigitalTwinSimulator
from app.services.weather import WeatherService
from app.services.weather_insights import build_weather_insight


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("gombe-air-quality-twin")

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
STATIC_DIR = BASE_DIR / "static"
settings = get_settings()

data_directory = Path(settings.data_dir)
if not data_directory.is_absolute():
    data_directory = PROJECT_DIR / data_directory
observation_store = ObservationStore(
    data_directory / "telemetry.sqlite3",
    retention_days=settings.history_retention_days,
)
predictor = AirQualityPredictor(
    data_directory / "air_quality_model.json",
    minimum_samples=settings.model_min_samples,
)
admin_guard = AdminGuard(settings)


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
weather_forecast_cache: list[dict[str, Any]] = []
air_forecast_cache: list[dict[str, Any]] = []
forecast_updated_at: str | None = None
weather_tile_cache: dict[tuple[str, int, int, int], tuple[float, bytes, str]] = {}
WEATHER_TILE_LAYERS = {
    "clouds": "clouds_new",
    "precipitation": "precipitation_new",
    "pressure": "pressure_new",
    "temperature": "temp_new",
    "wind": "wind_new",
}
background_tasks: list[asyncio.Task] = []


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    global background_tasks
    client = httpx.AsyncClient(timeout=25.0, follow_redirects=True)
    weather_service = WeatherService(settings, client)
    air_service = OpenAQService(settings, client)
    firms_service = FirmsService(settings, client)
    forecast_service = EnvironmentalForecastService(settings, client)
    app.state.http_client = client

    background_tasks = [
        asyncio.create_task(_load_geography(client)),
        asyncio.create_task(_refresh_loop("weather", weather_service.fetch, settings.weather_refresh_seconds)),
        asyncio.create_task(_refresh_loop("air_quality", air_service.fetch, settings.air_quality_refresh_seconds)),
        asyncio.create_task(_refresh_loop("firms", firms_service.fetch, settings.firms_refresh_seconds)),
        asyncio.create_task(_forecast_loop(forecast_service)),
        asyncio.create_task(_history_loop()),
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
    version="10.1.0",
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def frontend_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path in {"/", "/favicon.ico"} or request.url.path.startswith("/static/") or request.url.path.endswith(".html"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
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


async def _forecast_loop(service: EnvironmentalForecastService) -> None:
    global weather_forecast_cache, air_forecast_cache, forecast_updated_at
    while True:
        try:
            weather_result, air_result = await asyncio.gather(
                service.fetch_weather(),
                service.fetch_air_quality(),
                return_exceptions=True,
            )
            if isinstance(weather_result, list):
                weather_forecast_cache = weather_result
            elif isinstance(weather_result, Exception):
                logger.warning("Weather forecast refresh failed: %s", weather_result)
            if isinstance(air_result, list):
                air_forecast_cache = air_result
            elif isinstance(air_result, Exception):
                logger.warning("Air-quality forecast refresh failed: %s", air_result)
            forecast_updated_at = datetime.now(timezone.utc).isoformat()
            logger.info(
                "Refreshed forecast services: %s weather points, %s air-quality points",
                len(weather_forecast_cache),
                len(air_forecast_cache),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Forecast refresh failed: %s", exc)
        await asyncio.sleep(settings.forecast_refresh_seconds)


async def _history_loop() -> None:
    await asyncio.sleep(min(10.0, settings.history_sample_seconds / 2))
    while True:
        try:
            inserted = await asyncio.to_thread(observation_store.add_frame, latest_frame)
            if inserted:
                logger.info("Stored telemetry observation for model history")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Telemetry history write failed: %s", exc)
        await asyncio.sleep(settings.history_sample_seconds)


async def _broadcast_loop() -> None:
    global latest_frame
    while True:
        latest_frame = simulator.next_frame(len(manager.connections))
        await manager.broadcast(latest_frame)
        await asyncio.sleep(settings.broadcast_interval_seconds)


def _page(filename: str) -> FileResponse:
    return FileResponse(STATIC_DIR / filename)


def _lga_name(feature: dict[str, Any]) -> str:
    properties = feature.get("properties") or {}
    return str(
        properties.get("lga_name")
        or properties.get("shapeName")
        or properties.get("shape_name")
        or properties.get("name")
        or "Local Government Area"
    )


def _find_lga(name: str) -> dict[str, Any] | None:
    decoded = unquote(name).strip().casefold()
    for feature in (lga_cache or FALLBACK_GOMBE_LGAS).get("features", []):
        if _lga_name(feature).casefold() == decoded:
            return feature
    return None


def _bearer_value(authorization: str | None) -> str:
    if not authorization:
        return ""
    scheme, _, value = authorization.partition(" ")
    return value.strip() if scheme.lower() == "bearer" else ""


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return _page("index.html")


@app.get("/explore", include_in_schema=False)
async def explore_page() -> FileResponse:
    return _page("explore.html")


@app.get("/weather", include_in_schema=False)
async def weather_page() -> FileResponse:
    return _page("weather.html")


@app.get("/heat", include_in_schema=False)
async def heat_page() -> FileResponse:
    return _page("heat.html")


@app.get("/learn", include_in_schema=False)
async def learn_page() -> FileResponse:
    return _page("learn.html")


@app.get("/predictions", include_in_schema=False)
async def predictions_page() -> FileResponse:
    return _page("predictions.html")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> FileResponse:
    return FileResponse(STATIC_DIR / "favicon.svg", media_type="image/svg+xml")


@app.get("/api/services")
async def service_catalogue() -> dict[str, Any]:
    return {
        "architecture": "single-deployment service-oriented application",
        "services": [
            {"name": "Live Twin", "page": "/", "api": "/ws/live", "purpose": "One-second telemetry and animated Gombe map"},
            {"name": "Regional Explorer", "page": "/explore", "api": "/api/regions/insight", "purpose": "Source-labelled LGA evidence and health guidance"},
            {"name": "Weather Dynamics", "page": "/weather", "api": "/api/weather/insight", "purpose": "Live weather interpretation, provider map layers, sky circulation and forecast"},
            {"name": "Heat Intelligence", "page": "/heat", "api": "/api/heat/summary", "purpose": "Ambient heat, satellite thermal anomalies, wind alignment and source-labelled meaning"},
            {"name": "Evidence Lab", "page": "/learn", "api": "/api/regions/insight", "purpose": "Educational heat, wind and particulate explanations"},
            {"name": "AI Forecast", "page": "/predictions", "api": "/api/predictions/forecast", "purpose": "Provider forecast comparison and local experimental model"},
        ],
    }


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "mode": latest_frame.mode,
        "sequence": latest_frame.sequence,
        "connected_clients": len(manager.connections),
        "services": {
            "live_twin": "online",
            "regional_explorer": "online",
            "weather_forecast": "online" if weather_forecast_cache else "awaiting provider data",
            "provider_air_forecast": "online" if air_forecast_cache else "awaiting provider data",
            "heat_intelligence": "online",
            "local_ai_model": "ready" if predictor.model else "not trained",
            "admin_retraining": "enabled" if admin_guard.enabled else "disabled",
        },
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


@app.get("/api/regions")
async def regions() -> dict[str, Any]:
    features = (lga_cache or FALLBACK_GOMBE_LGAS).get("features", [])
    return {
        "regions": sorted([_lga_name(feature) for feature in features]),
        "count": len(features),
        "generated_at": latest_frame.generated_at,
    }


@app.get("/api/regions/insight")
async def region_insight(name: str) -> dict[str, Any]:
    feature = _find_lga(name)
    if feature is None:
        raise HTTPException(status_code=404, detail=f"LGA not found: {name}")
    return build_region_insight(_lga_name(feature), feature, latest_frame)


@app.get("/api/weather/forecast")
async def weather_forecast() -> dict[str, Any]:
    return {
        "updated_at": forecast_updated_at,
        "current": latest_frame.weather.model_dump(mode="json"),
        "source": latest_frame.sources.weather,
        "forecast": weather_forecast_cache,
        "interpretation": build_weather_insight(latest_frame, weather_forecast_cache, forecast_updated_at),
    }


@app.get("/api/weather/insight")
async def weather_insight() -> dict[str, Any]:
    """Return source-labelled interpretations derived from the current API frame."""
    return build_weather_insight(latest_frame, weather_forecast_cache, forecast_updated_at)


@app.get("/api/weather/layers")
async def weather_layers() -> dict[str, Any]:
    return {
        "available": bool(settings.openweather_api_key.strip()),
        "layers": [
            {"id": "precipitation", "label": "Precipitation", "kind": "provider weather tile"},
            {"id": "clouds", "label": "Cloud cover", "kind": "provider weather tile"},
            {"id": "wind", "label": "Wind speed", "kind": "provider weather tile"},
            {"id": "pressure", "label": "Pressure", "kind": "provider weather tile"},
            {"id": "temperature", "label": "Temperature", "kind": "provider weather tile"},
        ],
        "flow_notice": "Animated streamlines are modelled from the current wind vector and are not a direct radar measurement.",
    }


@app.get("/api/weather/tiles/{layer}/{z}/{x}/{y}.png", include_in_schema=False)
async def weather_tile(layer: str, z: int, x: int, y: int) -> Response:
    """Proxy allow-listed OpenWeather tiles without exposing the API key."""
    layer_name = WEATHER_TILE_LAYERS.get(layer)
    if layer_name is None:
        raise HTTPException(status_code=404, detail="Unknown weather layer")
    if not settings.openweather_api_key.strip():
        raise HTTPException(status_code=503, detail="OpenWeather map layer is not configured")
    if z < 0 or z > 18 or x < 0 or y < 0:
        raise HTTPException(status_code=400, detail="Invalid tile coordinate")

    cache_key = (layer, z, x, y)
    now = time.monotonic()
    cached = weather_tile_cache.get(cache_key)
    if cached and now - cached[0] <= 600.0:
        return Response(cached[1], media_type=cached[2], headers={"Cache-Control": "public, max-age=600"})

    client: httpx.AsyncClient | None = getattr(app.state, "http_client", None)
    if client is None:
        raise HTTPException(status_code=503, detail="Weather tile service is starting")
    response = await client.get(
        f"https://tile.openweathermap.org/map/{layer_name}/{z}/{x}/{y}.png",
        params={"appid": settings.openweather_api_key},
    )
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Weather tile is unavailable")
    if response.status_code in {401, 403}:
        raise HTTPException(status_code=503, detail="Weather map access is not enabled for this API key")
    response.raise_for_status()
    media_type = response.headers.get("content-type", "image/png").split(";", 1)[0]
    weather_tile_cache[cache_key] = (now, response.content, media_type)
    if len(weather_tile_cache) > 192:
        oldest = min(weather_tile_cache, key=lambda key: weather_tile_cache[key][0])
        weather_tile_cache.pop(oldest, None)
    return Response(response.content, media_type=media_type, headers={"Cache-Control": "public, max-age=600"})




@app.get("/api/heat/summary")
async def heat_summary() -> dict[str, Any]:
    return build_heat_summary(lga_cache or FALLBACK_GOMBE_LGAS, latest_frame)


@app.get("/api/heat/regions")
async def heat_regions() -> dict[str, Any]:
    return build_heat_regions(lga_cache or FALLBACK_GOMBE_LGAS, latest_frame)


@app.get("/api/heat/region")
async def heat_region(name: str) -> dict[str, Any]:
    feature = _find_lga(name)
    if feature is None:
        raise HTTPException(status_code=404, detail=f"LGA not found: {name}")
    return build_heat_region_insight(_lga_name(feature), feature, latest_frame)


@app.get("/api/predictions/status")
async def prediction_status() -> dict[str, Any]:
    stats = await asyncio.to_thread(observation_store.stats)
    return {
        **predictor.status(stats),
        "history": stats,
        "admin_retraining_enabled": admin_guard.enabled,
        "provider_forecast_available": bool(air_forecast_cache),
    }


@app.get("/api/predictions/forecast")
async def prediction_forecast(hours: int = 8) -> dict[str, Any]:
    horizon = max(1, min(int(hours), 16))
    provider = air_forecast_cache[:horizon]
    ai_result = predictor.predict(weather_forecast_cache, latest_frame, horizon_steps=horizon)
    return {
        "generated_at": latest_frame.generated_at,
        "current": {
            "pm25": latest_frame.air_quality.pm25,
            "pm10": latest_frame.air_quality.pm10,
            "aqi": latest_frame.air_quality.aqi,
            "category": latest_frame.air_quality.category,
            "source": latest_frame.sources.air_quality,
        },
        "provider_forecast": provider,
        "provider_note": (
            "Official provider forecast returned directly from OpenWeather Air Pollution API."
            if provider
            else "No provider forecast is currently available."
        ),
        "ai_forecast": ai_result,
    }


@app.post("/api/admin/model/retrain")
async def retrain_model(
    request: Request,
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    client_key = request.client.host if request.client else "unknown"
    admin_guard.verify(_bearer_value(authorization), client_key)
    records = await asyncio.to_thread(observation_store.recent, 10000, True)
    result = await asyncio.to_thread(predictor.train, records)
    status_code = 200 if result.status == "trained" else 409
    return JSONResponse(
        {
            "status": result.status,
            "message": result.message,
            "metadata": result.metadata,
        },
        status_code=status_code,
        headers={"Cache-Control": "no-store"},
    )


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
