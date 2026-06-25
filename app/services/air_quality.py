from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from statistics import median

import httpx

from app.config import Settings
from app.models import AirQualityReading, AirStation
from app.services.metrics import calculate_aqi


class OpenAQService:
    BASE_URL = "https://api.openaq.org/v3"

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self.settings = settings
        self.client = client

    async def fetch(self) -> AirQualityReading | None:
        if not self.settings.openaq_api_key:
            return None

        west, south, east, north = self.settings.gombe_bbox
        headers = {"X-API-Key": self.settings.openaq_api_key}
        locations_response = await self.client.get(
            f"{self.BASE_URL}/locations",
            headers=headers,
            params={
                "bbox": f"{west},{south},{east},{north}",
                "parameters_id": "1,2",
                "limit": 25,
                "page": 1,
            },
        )
        locations_response.raise_for_status()
        locations = locations_response.json().get("results", [])
        if not locations:
            return None

        station_tasks = [self._fetch_station(location, headers) for location in locations[:12]]
        station_results = await asyncio.gather(*station_tasks, return_exceptions=True)
        stations = [item for item in station_results if isinstance(item, AirStation)]
        if not stations:
            return None

        pm25_values = [station.pm25 for station in stations if station.pm25 >= 0]
        pm10_values = [station.pm10 for station in stations if station.pm10 >= 0]
        if not pm25_values and not pm10_values:
            return None

        pm25 = median(pm25_values) if pm25_values else median(pm10_values) * 0.45
        pm10 = median(pm10_values) if pm10_values else median(pm25_values) * 2.1
        aqi, category = calculate_aqi(pm25, pm10)
        observed_at = max((station.observed_at for station in stations), default=datetime.now(timezone.utc))
        return AirQualityReading(
            pm25=round(pm25, 1),
            pm10=round(pm10, 1),
            aqi=aqi,
            category=category,
            stations=stations,
            observed_at=observed_at,
        )

    async def _fetch_station(self, location: dict, headers: dict[str, str]) -> AirStation | None:
        location_id = location.get("id")
        if location_id is None:
            return None

        sensor_parameter_by_id = {
            int(sensor["id"]): sensor.get("parameter", {}).get("name", "")
            for sensor in location.get("sensors", [])
            if sensor.get("id") is not None
        }
        latest_response = await self.client.get(
            f"{self.BASE_URL}/locations/{location_id}/latest",
            headers=headers,
            params={"limit": 100, "page": 1},
        )
        latest_response.raise_for_status()
        measurements = latest_response.json().get("results", [])

        values: dict[str, float] = {}
        observed_at = datetime.now(timezone.utc)
        for item in measurements:
            parameter_name = sensor_parameter_by_id.get(int(item.get("sensorsId", -1)), "")
            if parameter_name in {"pm25", "pm10"}:
                values[parameter_name] = float(item.get("value", 0.0))
                utc_value = item.get("datetime", {}).get("utc")
                if utc_value:
                    observed_at = datetime.fromisoformat(utc_value.replace("Z", "+00:00"))

        if not values:
            return None

        coordinates = location.get("coordinates") or {}
        pm25 = values.get("pm25", values.get("pm10", 0.0) * 0.45)
        pm10 = values.get("pm10", values.get("pm25", 0.0) * 2.1)
        return AirStation(
            id=str(location_id),
            name=str(location.get("name") or location.get("locality") or f"OpenAQ {location_id}"),
            latitude=float(coordinates.get("latitude", self.settings.gombe_lat)),
            longitude=float(coordinates.get("longitude", self.settings.gombe_lon)),
            pm25=round(pm25, 1),
            pm10=round(pm10, 1),
            observed_at=observed_at,
            source="OpenAQ",
        )
