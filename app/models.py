from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field


DataMode = Literal["live", "mixed", "demo"]


class SourceStatus(BaseModel):
    weather: str = "demo"
    air_quality: str = "demo"
    firms: str = "demo"


class WeatherReading(BaseModel):
    temperature_c: float = 31.0
    feels_like_c: float = 31.0
    temperature_min_c: float = 31.0
    temperature_max_c: float = 31.0
    humidity_pct: float = 25.0
    pressure_hpa: float = 1008.0
    wind_speed_ms: float = 7.0
    wind_direction_deg: float = 52.0
    wind_gust_ms: float = 10.0
    wind_gust_reported: bool = False
    visibility_m: float = 6000.0
    visibility_reported: bool = False
    cloud_cover_pct: float = 18.0
    precipitation_mm_1h: float = 0.0
    condition: str = "Dust haze"
    condition_group: str = "Haze"
    weather_code: int = 721
    icon_code: str = "50d"
    sunrise_at: datetime | None = None
    sunset_at: datetime | None = None
    timezone_offset_seconds: int = 3600
    observed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AirStation(BaseModel):
    id: str
    name: str
    latitude: float
    longitude: float
    pm25: float
    pm10: float
    observed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    source: str = "OpenAQ"


class AirQualityReading(BaseModel):
    pm25: float = 82.0
    pm10: float = 176.0
    aqi: int = 164
    category: str = "Unhealthy"
    stations: list[AirStation] = Field(default_factory=list)
    observed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FireHotspot(BaseModel):
    id: str
    latitude: float
    longitude: float
    frp: float = 0.0
    brightness: float = 0.0
    confidence: str = "nominal"
    acquired_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DerivedIndicators(BaseModel):
    dust_index: float = 0.0
    health_risk: int = 0
    aviation_risk: int = 0
    dispersion_score: float = 0.0
    visibility_estimate_km: float = 10.0
    alert_level: Literal["normal", "watch", "warning", "severe"] = "normal"
    alert_message: str = "Conditions are stable."


class TelemetryFrame(BaseModel):
    sequence: int = 0
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    mode: DataMode = "demo"
    sources: SourceStatus = Field(default_factory=SourceStatus)
    weather: WeatherReading = Field(default_factory=WeatherReading)
    air_quality: AirQualityReading = Field(default_factory=AirQualityReading)
    hotspots: list[FireHotspot] = Field(default_factory=list)
    derived: DerivedIndicators = Field(default_factory=DerivedIndicators)
    connected_clients: int = 0
