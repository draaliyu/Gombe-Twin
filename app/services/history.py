from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.models import TelemetryFrame


class ObservationStore:
    """Small SQLite telemetry store used by the forecasting service.

    Only values received from live providers are marked as model-eligible. The
    store intentionally keeps the provider labels with every row so the model
    cannot silently train on demonstration values.
    """

    def __init__(self, database_path: Path, retention_days: int = 90) -> None:
        self.database_path = database_path
        self.retention_days = max(1, int(retention_days))
        self._lock = threading.RLock()
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialise()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=20.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        return connection

    def _initialise(self) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS observations (
                    observed_at TEXT PRIMARY KEY,
                    generated_at TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    pm25 REAL NOT NULL,
                    pm10 REAL NOT NULL,
                    aqi INTEGER NOT NULL,
                    temperature REAL NOT NULL,
                    humidity REAL NOT NULL,
                    pressure REAL NOT NULL,
                    wind_speed REAL NOT NULL,
                    wind_direction REAL NOT NULL,
                    wind_gust REAL NOT NULL,
                    cloud_cover REAL NOT NULL,
                    rainfall REAL NOT NULL,
                    visibility REAL NOT NULL,
                    hotspot_count INTEGER NOT NULL,
                    dust_index REAL NOT NULL,
                    health_risk INTEGER NOT NULL,
                    aviation_risk INTEGER NOT NULL,
                    weather_source TEXT NOT NULL,
                    air_source TEXT NOT NULL,
                    firms_source TEXT NOT NULL,
                    model_eligible INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_observations_eligible_time "
                "ON observations(model_eligible, observed_at)"
            )

    @staticmethod
    def _eligible(frame: TelemetryFrame) -> bool:
        weather_live = "openweather" in frame.sources.weather.lower()
        air_live = "openaq" in frame.sources.air_quality.lower()
        return weather_live and air_live

    def add_frame(self, frame: TelemetryFrame) -> bool:
        observed_at = min(frame.weather.observed_at, frame.air_quality.observed_at)
        values = (
            observed_at.astimezone(timezone.utc).isoformat(),
            frame.generated_at.astimezone(timezone.utc).isoformat(),
            frame.mode,
            float(frame.air_quality.pm25),
            float(frame.air_quality.pm10),
            int(frame.air_quality.aqi),
            float(frame.weather.temperature_c),
            float(frame.weather.humidity_pct),
            float(frame.weather.pressure_hpa),
            float(frame.weather.wind_speed_ms),
            float(frame.weather.wind_direction_deg),
            float(frame.weather.wind_gust_ms),
            float(frame.weather.cloud_cover_pct),
            float(frame.weather.precipitation_mm_1h),
            float(frame.weather.visibility_m),
            len(frame.hotspots),
            float(frame.derived.dust_index),
            int(frame.derived.health_risk),
            int(frame.derived.aviation_risk),
            frame.sources.weather,
            frame.sources.air_quality,
            frame.sources.firms,
            1 if self._eligible(frame) else 0,
        )
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO observations (
                    observed_at, generated_at, mode, pm25, pm10, aqi,
                    temperature, humidity, pressure, wind_speed,
                    wind_direction, wind_gust, cloud_cover, rainfall,
                    visibility, hotspot_count, dust_index, health_risk,
                    aviation_risk, weather_source, air_source, firms_source,
                    model_eligible
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                values,
            )
            self._cleanup(connection)
            return cursor.rowcount > 0

    def _cleanup(self, connection: sqlite3.Connection) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=self.retention_days)
        connection.execute(
            "DELETE FROM observations WHERE observed_at < ?",
            (cutoff.isoformat(),),
        )

    def recent(self, limit: int = 5000, eligible_only: bool = False) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 20000))
        where = "WHERE model_eligible = 1" if eligible_only else ""
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM observations {where} ORDER BY observed_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(row) for row in reversed(rows)]

    def stats(self) -> dict[str, Any]:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) AS total,
                       SUM(CASE WHEN model_eligible = 1 THEN 1 ELSE 0 END) AS eligible,
                       MIN(observed_at) AS first_observation,
                       MAX(observed_at) AS last_observation
                FROM observations
                """
            ).fetchone()
        return {
            "total_observations": int(row["total"] or 0),
            "eligible_observations": int(row["eligible"] or 0),
            "first_observation": row["first_observation"],
            "last_observation": row["last_observation"],
            "database": str(self.database_path),
        }
