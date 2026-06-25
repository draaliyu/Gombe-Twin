from __future__ import annotations

from datetime import datetime, timezone

import httpx

from app.config import Settings
from app.models import WeatherReading


class WeatherService:
    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self.settings = settings
        self.client = client

    async def fetch(self) -> WeatherReading | None:
        if not self.settings.openweather_api_key:
            return None

        response = await self.client.get(
            "https://api.openweathermap.org/data/2.5/weather",
            params={
                "lat": self.settings.gombe_lat,
                "lon": self.settings.gombe_lon,
                "appid": self.settings.openweather_api_key,
                "units": "metric",
            },
        )
        response.raise_for_status()
        payload = response.json()
        weather_items = payload.get("weather") or [{}]
        wind = payload.get("wind") or {}
        main = payload.get("main") or {}
        clouds = payload.get("clouds") or {}
        rain = payload.get("rain") or {}

        return WeatherReading(
            temperature_c=float(main.get("temp", 31.0)),
            humidity_pct=float(main.get("humidity", 25.0)),
            pressure_hpa=float(main.get("pressure", 1008.0)),
            wind_speed_ms=float(wind.get("speed", 7.0)),
            wind_direction_deg=float(wind.get("deg", 52.0)),
            wind_gust_ms=float(wind.get("gust", wind.get("speed", 7.0) * 1.35)),
            visibility_m=float(payload.get("visibility", 10000.0)),
            cloud_cover_pct=float(clouds.get("all", 0.0)),
            precipitation_mm_1h=float(rain.get("1h", 0.0)),
            condition=str(weather_items[0].get("description", "Current conditions")).title(),
            observed_at=datetime.fromtimestamp(payload.get("dt", datetime.now().timestamp()), tz=timezone.utc),
        )
