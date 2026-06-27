from __future__ import annotations

import math
import random
from copy import deepcopy
from datetime import datetime, timezone

from app.config import Settings
from app.models import (
    AirQualityReading,
    AirStation,
    FireHotspot,
    SourceStatus,
    TelemetryFrame,
    WeatherReading,
)
from app.services.metrics import calculate_aqi, derive_indicators


SENSOR_POINTS = [
    ("Gombe Central", 10.2897, 11.1673),
    ("Akko", 10.0113, 10.9824),
    ("Kaltungo", 9.8142, 11.3089),
    ("Billiri", 9.8654, 11.2262),
    ("Dukku", 10.8238, 10.7722),
    ("Bajoga", 10.8515, 11.4317),
    ("Nafada", 11.0960, 11.3327),
    ("Deba", 10.2119, 11.3857),
]


class DigitalTwinSimulator:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.sequence = 0
        self.random = random.Random(20260625)
        self.weather = WeatherReading()
        self.air_quality = AirQualityReading(stations=self._synthetic_stations(82.0, 176.0))
        self.hotspots = self._synthetic_hotspots()
        self.sources = SourceStatus()
        self._live_flags = {"weather": False, "air_quality": False, "firms": False}
        self._phase = self.random.uniform(0, math.tau)

    def apply_weather(self, weather: WeatherReading | None) -> None:
        if weather is not None:
            self.weather = weather
            self.sources.weather = "OpenWeather live"
            self._live_flags["weather"] = True
        else:
            self.sources.weather = "Physics-informed demo"

    def apply_air_quality(self, air_quality: AirQualityReading | None) -> None:
        if air_quality is not None:
            self.air_quality = air_quality
            self.sources.air_quality = "OpenAQ v3 live"
            self._live_flags["air_quality"] = True
        else:
            self.sources.air_quality = "Spatially modelled demo"

    def apply_hotspots(self, hotspots: list[FireHotspot] | None) -> None:
        if hotspots is not None:
            self.hotspots = hotspots
            self.sources.firms = "NASA FIRMS near-real-time"
            self._live_flags["firms"] = True
        else:
            self.sources.firms = "Synthetic hotspot layer"

    def next_frame(self, connected_clients: int) -> TelemetryFrame:
        self.sequence += 1
        now = datetime.now(timezone.utc)
        seconds = now.timestamp()
        phase = self._phase + seconds / 11.0

        weather = deepcopy(self.weather)
        air = deepcopy(self.air_quality)

        # Preserve values received from live APIs exactly. Continuous visual
        # motion is handled by the browser renderers; it must not be mistaken
        # for new environmental measurements. Only missing/demo sources are
        # animated to keep the standalone demonstration usable.
        if not self._live_flags["weather"]:
            weather.wind_speed_ms = round(max(0.2, weather.wind_speed_ms + 0.35 * math.sin(phase) + self.random.uniform(-0.07, 0.07)), 2)
            weather.wind_gust_ms = round(max(weather.wind_speed_ms, weather.wind_gust_ms + 0.55 * math.sin(phase * 0.73)), 2)
            weather.wind_direction_deg = round((weather.wind_direction_deg + 2.4 * math.sin(phase * 0.31)) % 360, 1)
            weather.humidity_pct = round(max(5.0, min(100.0, weather.humidity_pct + 0.7 * math.sin(phase * 0.19))), 1)
            weather.temperature_c = round(weather.temperature_c + 0.25 * math.sin(phase * 0.11), 1)
            weather.pressure_hpa = round(weather.pressure_hpa + 0.35 * math.sin(phase * 0.07), 1)
            weather.cloud_cover_pct = round(max(0.0, min(100.0, weather.cloud_cover_pct + 1.2 * math.sin(phase * 0.13))), 1)
            weather.precipitation_mm_1h = round(max(0.0, weather.precipitation_mm_1h + 0.02 * math.sin(phase * 0.17)), 2)

        if not self._live_flags["air_quality"]:
            pm_wave = 1.8 * math.sin(phase * 0.47) + 0.75 * math.sin(phase * 1.13)
            wind_resuspension = max(0.0, weather.wind_speed_ms - 5.0) * 0.42
            air.pm25 = round(max(1.0, air.pm25 + pm_wave * 0.28 + wind_resuspension * 0.07), 1)
            air.pm10 = round(max(2.0, air.pm10 + pm_wave * 0.72 + wind_resuspension * 0.26), 1)
            air.aqi, air.category = calculate_aqi(air.pm25, air.pm10)
            air.stations = self._animate_stations(air.stations, air.pm25, air.pm10, phase)

        indicators = derive_indicators(weather, air, len(self.hotspots))
        live_count = sum(self._live_flags.values())
        mode = "live" if live_count == 3 else "mixed" if live_count else "demo"

        return TelemetryFrame(
            sequence=self.sequence,
            generated_at=now,
            mode=mode,
            sources=self.sources,
            weather=weather,
            air_quality=air,
            hotspots=self.hotspots,
            derived=indicators,
            connected_clients=connected_clients,
        )

    def _synthetic_stations(self, pm25: float, pm10: float) -> list[AirStation]:
        stations = []
        for index, (name, latitude, longitude) in enumerate(SENSOR_POINTS):
            factor = 0.82 + 0.08 * index + self.random.uniform(-0.08, 0.08)
            stations.append(
                AirStation(
                    id=f"demo-{index}",
                    name=name,
                    latitude=latitude,
                    longitude=longitude,
                    pm25=round(pm25 * factor, 1),
                    pm10=round(pm10 * factor, 1),
                    source="Modelled virtual sensor",
                )
            )
        return stations

    def _animate_stations(
        self,
        stations: list[AirStation],
        central_pm25: float,
        central_pm10: float,
        phase: float,
    ) -> list[AirStation]:
        if not stations:
            return self._synthetic_stations(central_pm25, central_pm10)
        animated = []
        for index, station in enumerate(stations):
            item = station.model_copy(deep=True)
            spatial = 0.90 + 0.16 * math.sin(phase * 0.31 + index * 0.93)
            item.pm25 = round(max(0.0, central_pm25 * spatial), 1)
            item.pm10 = round(max(0.0, central_pm10 * (spatial + 0.04 * math.cos(phase + index))), 1)
            animated.append(item)
        return animated

    def _synthetic_hotspots(self) -> list[FireHotspot]:
        return [
            FireHotspot(id="demo-fire-1", latitude=10.63, longitude=11.68, frp=8.4, brightness=328.0),
            FireHotspot(id="demo-fire-2", latitude=9.78, longitude=11.54, frp=4.7, brightness=316.0),
            FireHotspot(id="demo-fire-3", latitude=10.97, longitude=10.81, frp=6.1, brightness=321.0),
        ]
