from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import Settings
from app.services.metrics import calculate_aqi


class EnvironmentalForecastService:
    """Fetch official provider forecasts without inventing missing values."""

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self.settings = settings
        self.client = client

    async def fetch_weather(self) -> list[dict[str, Any]]:
        if not self.settings.openweather_api_key:
            return []
        response = await self.client.get(
            "https://api.openweathermap.org/data/2.5/forecast",
            params={
                "lat": self.settings.gombe_lat,
                "lon": self.settings.gombe_lon,
                "appid": self.settings.openweather_api_key,
                "units": "metric",
            },
        )
        response.raise_for_status()
        entries: list[dict[str, Any]] = []
        for item in response.json().get("list", []):
            main = item.get("main") or {}
            wind = item.get("wind") or {}
            clouds = item.get("clouds") or {}
            rain = item.get("rain") or {}
            weather = (item.get("weather") or [{}])[0]
            timestamp = datetime.fromtimestamp(float(item.get("dt", 0)), tz=timezone.utc)
            entries.append(
                {
                    "timestamp": timestamp.isoformat(),
                    "temperature_c": float(main.get("temp", 0.0)),
                    "feels_like_c": float(main.get("feels_like", main.get("temp", 0.0))),
                    "temperature_min_c": float(main.get("temp_min", main.get("temp", 0.0))),
                    "temperature_max_c": float(main.get("temp_max", main.get("temp", 0.0))),
                    "humidity_pct": float(main.get("humidity", 0.0)),
                    "pressure_hpa": float(main.get("pressure", 0.0)),
                    "wind_speed_ms": float(wind.get("speed", 0.0)),
                    "wind_direction_deg": float(wind.get("deg", 0.0)),
                    "wind_gust_ms": float(wind.get("gust", wind.get("speed", 0.0))),
                    "cloud_cover_pct": float(clouds.get("all", 0.0)),
                    "precipitation_probability_pct": float(item.get("pop", 0.0)) * 100.0,
                    "precipitation_mm_3h": float(rain.get("3h", 0.0)),
                    "snow_mm_3h": float((item.get("snow") or {}).get("3h", 0.0)),
                    "condition": str(weather.get("description", "Forecast")).title(),
                    "condition_group": str(weather.get("main", "Forecast")),
                    "weather_code": int(weather.get("id", 0) or 0),
                    "icon_code": str(weather.get("icon", "")),
                    "provider": "OpenWeather 5-day / 3-hour forecast",
                }
            )
        return entries

    async def fetch_air_quality(self) -> list[dict[str, Any]]:
        if not self.settings.openweather_api_key:
            return []
        response = await self.client.get(
            "https://api.openweathermap.org/data/2.5/air_pollution/forecast",
            params={
                "lat": self.settings.gombe_lat,
                "lon": self.settings.gombe_lon,
                "appid": self.settings.openweather_api_key,
            },
        )
        response.raise_for_status()
        entries: list[dict[str, Any]] = []
        for item in response.json().get("list", []):
            components = item.get("components") or {}
            pm25 = float(components.get("pm2_5", 0.0))
            pm10 = float(components.get("pm10", 0.0))
            aqi, category = calculate_aqi(pm25, pm10)
            timestamp = datetime.fromtimestamp(float(item.get("dt", 0)), tz=timezone.utc)
            entries.append(
                {
                    "timestamp": timestamp.isoformat(),
                    "pm25": round(pm25, 1),
                    "pm10": round(pm10, 1),
                    "aqi": aqi,
                    "category": category,
                    "provider_index": int((item.get("main") or {}).get("aqi", 0)),
                    "provider": "OpenWeather Air Pollution forecast",
                }
            )
        return entries
