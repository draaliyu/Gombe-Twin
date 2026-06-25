from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

import httpx

from app.config import Settings
from app.models import FireHotspot


class FirmsService:
    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self.settings = settings
        self.client = client

    async def fetch(self) -> list[FireHotspot] | None:
        if not self.settings.nasa_firms_map_key:
            return None

        west, south, east, north = self.settings.gombe_bbox
        area = f"{west},{south},{east},{north}"
        url = (
            "https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
            f"{self.settings.nasa_firms_map_key}/VIIRS_SNPP_NRT/{area}/2"
        )
        response = await self.client.get(url)
        response.raise_for_status()
        rows = csv.DictReader(io.StringIO(response.text))
        hotspots: list[FireHotspot] = []

        for index, row in enumerate(rows):
            try:
                acquisition = datetime.strptime(
                    f"{row.get('acq_date', '')} {str(row.get('acq_time', '0000')).zfill(4)}",
                    "%Y-%m-%d %H%M",
                ).replace(tzinfo=timezone.utc)
                latitude = float(row["latitude"])
                longitude = float(row["longitude"])
            except (KeyError, TypeError, ValueError):
                continue

            hotspots.append(
                FireHotspot(
                    id=f"firms-{row.get('satellite', 'sat')}-{index}-{latitude:.4f}-{longitude:.4f}",
                    latitude=latitude,
                    longitude=longitude,
                    frp=float(row.get("frp") or 0.0),
                    brightness=float(row.get("bright_ti4") or row.get("brightness") or 0.0),
                    confidence=str(row.get("confidence") or "nominal"),
                    acquired_at=acquisition,
                )
            )

        return hotspots[:150]
