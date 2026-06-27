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
        system = payload.get("sys") or {}
        primary_weather = weather_items[0]

        # Temperature, humidity, pressure and sustained wind are required for a
        # frame to be accepted as live. Optional fields retain explicit flags
        # so a display fallback can never be mistaken for a provider reading.
        required = ("temp", "humidity", "pressure")
        if any(key not in main for key in required) or "speed" not in wind:
            raise ValueError("OpenWeather response is missing required current-condition fields")

        wind_speed = float(wind["speed"])
        gust_reported = wind.get("gust") is not None
        visibility_reported = payload.get("visibility") is not None

        sunrise_value = system.get("sunrise")
        sunset_value = system.get("sunset")
        return WeatherReading(
            temperature_c=float(main["temp"]),
            feels_like_c=float(main.get("feels_like", main["temp"])),
            temperature_min_c=float(main.get("temp_min", main["temp"])),
            temperature_max_c=float(main.get("temp_max", main["temp"])),
            humidity_pct=float(main["humidity"]),
            pressure_hpa=float(main["pressure"]),
            wind_speed_ms=wind_speed,
            wind_direction_deg=float(wind.get("deg", 0.0)),
            # When gust is absent, sustained wind is retained only as a
            # transparent lower-bound display value; the flag below is false.
            wind_gust_ms=float(wind["gust"]) if gust_reported else wind_speed,
            wind_gust_reported=gust_reported,
            visibility_m=float(payload["visibility"]) if visibility_reported else 10000.0,
            visibility_reported=visibility_reported,
            cloud_cover_pct=float(clouds.get("all", 0.0)),
            precipitation_mm_1h=float(rain.get("1h", 0.0)),
            condition=str(primary_weather.get("description", "Current conditions")).title(),
            condition_group=str(primary_weather.get("main", "Current conditions")),
            weather_code=int(primary_weather.get("id", 0) or 0),
            icon_code=str(primary_weather.get("icon", "")),
            sunrise_at=datetime.fromtimestamp(float(sunrise_value), tz=timezone.utc) if sunrise_value is not None else None,
            sunset_at=datetime.fromtimestamp(float(sunset_value), tz=timezone.utc) if sunset_value is not None else None,
            timezone_offset_seconds=int(payload.get("timezone", 3600) or 3600),
            observed_at=datetime.fromtimestamp(payload.get("dt", datetime.now().timestamp()), tz=timezone.utc),
        )
