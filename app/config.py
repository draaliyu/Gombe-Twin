from __future__ import annotations

import ast
from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


DEFAULT_GOMBE_BBOX: tuple[float, float, float, float] = (
    10.15,
    9.45,
    12.35,
    11.55,
)


class Settings(BaseSettings):
    """Application settings loaded from environment variables or ``.env``.

    ``GOMBE_BBOX`` intentionally uses ``NoDecode`` so Pydantic does not try
    to JSON-decode the environment value before our validator sees it. This
    allows users to enter either of these forms safely:

    ``GOMBE_BBOX=10.15,9.45,12.35,11.55``
    ``GOMBE_BBOX=[10.15,9.45,12.35,11.55]``
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    openweather_api_key: str = ""
    openaq_api_key: str = ""
    nasa_firms_map_key: str = ""

    weather_refresh_seconds: int = Field(default=180, ge=30)
    air_quality_refresh_seconds: int = Field(default=300, ge=60)
    firms_refresh_seconds: int = Field(default=600, ge=120)
    broadcast_interval_seconds: float = Field(default=1.0, ge=0.25, le=10.0)

    gombe_lat: float = 10.2897
    gombe_lon: float = 11.1673
    gombe_bbox: Annotated[
        tuple[float, float, float, float],
        NoDecode,
    ] = DEFAULT_GOMBE_BBOX

    @field_validator("gombe_bbox", mode="before")
    @classmethod
    def parse_bbox(cls, value: object) -> tuple[float, float, float, float]:
        """Parse a bounding box from CSV, JSON-list, tuple, or list input."""

        if value is None:
            return DEFAULT_GOMBE_BBOX

        parsed: object = value

        if isinstance(value, str):
            text = value.strip()
            if not text:
                return DEFAULT_GOMBE_BBOX

            if text.startswith(("[", "(")):
                try:
                    parsed = ast.literal_eval(text)
                except (SyntaxError, ValueError) as exc:
                    raise ValueError(
                        "GOMBE_BBOX must be west,south,east,north or "
                        "[west,south,east,north]"
                    ) from exc
            else:
                parsed = [item.strip() for item in text.split(",")]

        if not isinstance(parsed, (list, tuple)) or len(parsed) != 4:
            raise ValueError(
                "GOMBE_BBOX must contain exactly four values: "
                "west,south,east,north"
            )

        try:
            west, south, east, north = (float(item) for item in parsed)
        except (TypeError, ValueError) as exc:
            raise ValueError("Every GOMBE_BBOX value must be numeric") from exc

        if not -180.0 <= west <= 180.0 or not -180.0 <= east <= 180.0:
            raise ValueError("GOMBE_BBOX west/east values must be valid longitudes")

        if not -90.0 <= south <= 90.0 or not -90.0 <= north <= 90.0:
            raise ValueError("GOMBE_BBOX south/north values must be valid latitudes")

        if west >= east:
            raise ValueError("GOMBE_BBOX west must be less than east")

        if south >= north:
            raise ValueError("GOMBE_BBOX south must be less than north")

        return west, south, east, north

    @property
    def demo_mode(self) -> bool:
        return not all(
            [
                self.openweather_api_key.strip(),
                self.openaq_api_key.strip(),
                self.nasa_firms_map_key.strip(),
            ]
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
