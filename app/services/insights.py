from __future__ import annotations

import math
from datetime import timezone
from typing import Any

from app.models import AirStation, TelemetryFrame
from app.services.metrics import calculate_aqi


EARTH_RADIUS_KM = 6371.0088


def _haversine_km(left: tuple[float, float], right: tuple[float, float]) -> float:
    lon1, lat1 = map(math.radians, left)
    lon2, lat2 = map(math.radians, right)
    delta_lon = lon2 - lon1
    delta_lat = lat2 - lat1
    value = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(value)))


def representative_point(feature: dict[str, Any]) -> tuple[float, float]:
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") == "Point" and len(coordinates) >= 2:
        return float(coordinates[0]), float(coordinates[1])
    rings: list[list[list[float]]] = []
    if geometry.get("type") == "Polygon" and coordinates:
        rings = [coordinates[0]]
    elif geometry.get("type") == "MultiPolygon":
        rings = [polygon[0] for polygon in coordinates if polygon]
    points = [point for ring in rings for point in ring if len(point) >= 2]
    if not points:
        return 11.1673, 10.2897
    return (
        sum(float(point[0]) for point in points) / len(points),
        sum(float(point[1]) for point in points) / len(points),
    )


def _compass(degrees: float) -> str:
    labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return labels[int((degrees + 22.5) // 45) % 8]


def _aqi_colour(aqi: int) -> str:
    if aqi <= 50:
        return "#43d17c"
    if aqi <= 100:
        return "#f0d34f"
    if aqi <= 150:
        return "#ff963f"
    if aqi <= 200:
        return "#ef4f58"
    return "#8c4ab8"


def _health_recommendation(aqi: int) -> str:
    if aqi <= 50:
        return "Air quality is in the Good category; normal outdoor activity is generally appropriate."
    if aqi <= 100:
        return "Air quality is Moderate. Unusually sensitive people should watch for symptoms during prolonged outdoor activity."
    if aqi <= 150:
        return "Sensitive groups should reduce prolonged or heavy outdoor exertion and monitor respiratory symptoms."
    if aqi <= 200:
        return "Everyone should reduce prolonged outdoor exertion; sensitive groups should avoid heavy outdoor activity."
    return "Avoid non-essential outdoor exertion. Sensitive groups should remain in cleaner indoor air and follow local health advice."


def _station_estimate(
    coordinate: tuple[float, float],
    stations: list[AirStation],
    state_pm25: float,
    state_pm10: float,
) -> dict[str, Any]:
    candidates: list[tuple[float, AirStation]] = []
    for station in stations:
        distance = _haversine_km(coordinate, (station.longitude, station.latitude))
        candidates.append((distance, station))
    candidates.sort(key=lambda item: item[0])
    nearest = candidates[:4]
    if not nearest:
        return {
            "pm25": state_pm25,
            "pm10": state_pm10,
            "method": "State aggregate because no geolocated stations were available",
            "station_count": 0,
            "nearest_station_km": None,
            "confidence": "low",
            "stations": [],
        }

    weights = [1.0 / max(distance, 5.0) ** 2 for distance, _ in nearest]
    weight_sum = sum(weights)
    pm25 = sum(weight * station.pm25 for weight, (_, station) in zip(weights, nearest)) / weight_sum
    pm10 = sum(weight * station.pm10 for weight, (_, station) in zip(weights, nearest)) / weight_sum
    nearest_distance = nearest[0][0]
    confidence = "high" if nearest_distance <= 15 and len(nearest) >= 2 else "medium" if nearest_distance <= 50 else "low"
    all_live = all("openaq" in station.source.lower() for _, station in nearest)
    method = (
        "Inverse-distance interpolation from the nearest OpenAQ stations"
        if all_live
        else "Demonstration interpolation from virtual sensor points; not a measured local value"
    )
    return {
        "pm25": pm25,
        "pm10": pm10,
        "method": method,
        "station_count": len(nearest),
        "nearest_station_km": round(nearest_distance, 1),
        "confidence": confidence,
        "stations": [
            {
                "name": station.name,
                "distance_km": round(distance, 1),
                "pm25": station.pm25,
                "pm10": station.pm10,
                "source": station.source,
                "observed_at": station.observed_at.astimezone(timezone.utc).isoformat(),
            }
            for distance, station in nearest
        ],
    }


def build_region_insight(name: str, feature: dict[str, Any], frame: TelemetryFrame) -> dict[str, Any]:
    coordinate = representative_point(feature)
    estimate = _station_estimate(
        coordinate,
        frame.air_quality.stations,
        float(frame.air_quality.pm25),
        float(frame.air_quality.pm10),
    )
    aqi, category = calculate_aqi(estimate["pm25"], estimate["pm10"])
    wind_from = float(frame.weather.wind_direction_deg) % 360
    transport_to = (wind_from + 180.0) % 360
    hotspot_distances = [
        (
            _haversine_km(coordinate, (hotspot.longitude, hotspot.latitude)),
            hotspot,
        )
        for hotspot in frame.hotspots
    ]
    hotspot_distances.sort(key=lambda item: item[0])
    nearby_hotspots = [item for item in hotspot_distances if item[0] <= 75.0]
    nearest_hotspot = hotspot_distances[0] if hotspot_distances else None
    total_nearby_frp = sum(float(hotspot.frp) for _, hotspot in nearby_hotspots)

    ratio = estimate["pm10"] / max(estimate["pm25"], 0.1)
    dry_screen = frame.weather.humidity_pct < 40 and frame.weather.precipitation_mm_1h <= 0.05
    windy_screen = frame.weather.wind_speed_ms >= 5
    coarse_screen = ratio >= 1.7

    weather_live = "openweather" in frame.sources.weather.lower()
    air_live = "openaq" in frame.sources.air_quality.lower()
    firms_live = "nasa firms" in frame.sources.firms.lower()
    if estimate["station_count"] == 0:
        estimate["method"] = (
            "OpenAQ state aggregate; no geolocated contributing station was available"
            if air_live
            else "Demonstration state aggregate; no geolocated live station was available"
        )
    if weather_live and air_live:
        evidence_mode = "live-api"
        evidence_notice = "Weather and particulate evidence in this view comes from live provider observations; local particulate values may still be spatial estimates between stations."
    elif weather_live or air_live or firms_live:
        evidence_mode = "mixed"
        evidence_notice = "This view mixes live provider observations with clearly labelled fallback or demonstration layers. Read each source label before interpreting the result."
    else:
        evidence_mode = "demonstration"
        evidence_notice = "Live provider observations are unavailable. This region view is a labelled demonstration and must not be treated as a measurement."

    heat_evidence = [
        {
            "label": "Ambient temperature",
            "value": f"{frame.weather.temperature_c:.1f} °C",
            "interpretation": (
                "State-level temperature reported by the live weather feed."
                if weather_live
                else "Demonstration state-level temperature; a live weather observation is not currently available."
            ),
            "source": frame.sources.weather,
        },
        {
            "label": "Humidity",
            "value": f"{frame.weather.humidity_pct:.0f}%",
            "interpretation": (
                "Humidity is reported by the state-centre weather feed; it is not an LGA-specific sensor."
                if weather_live
                else "Demonstration humidity; it is not an LGA-specific measurement."
            ),
            "source": frame.sources.weather,
        },
        {
            "label": "Nearby thermal detections",
            "value": str(len(nearby_hotspots)),
            "interpretation": (
                f"FIRMS detections within 75 km total {total_nearby_frp:.1f} MW of reported fire radiative power."
                if nearby_hotspots
                else "No FIRMS detection is present within 75 km in the current feed."
            ),
            "source": frame.sources.firms,
        },
    ]

    wind_evidence = [
        {
            "label": "Wind reported from",
            "value": f"{_compass(wind_from)} · {wind_from:.0f}°",
            "interpretation": "Meteorological wind direction describes where the wind comes from.",
            "source": frame.sources.weather,
        },
        {
            "label": "Estimated transport toward",
            "value": f"{_compass(transport_to)} · {transport_to:.0f}°",
            "interpretation": "This is the opposite bearing and represents the downwind transport direction.",
            "source": "Calculated from the reported wind bearing",
        },
        {
            "label": "Wind and gust",
            "value": f"{frame.weather.wind_speed_ms:.1f} / {frame.weather.wind_gust_ms:.1f} m/s",
            "interpretation": (
                "The first value is sustained wind and the second is a provider-reported gust."
                if frame.weather.wind_gust_reported
                else "The provider did not report a gust; the second value repeats sustained wind as a labelled lower-bound display value."
            ),
            "source": frame.sources.weather,
        },
    ]

    particle_interpretation = (
        "The current combination of a higher coarse-particle fraction, dry conditions and active wind is consistent with dust transport or resuspension. "
        "The available APIs cannot by themselves prove the particle source."
        if coarse_screen and dry_screen and windy_screen
        else "The available measurements do not satisfy all three screening signals used here for coarse dust: a high PM10/PM2.5 ratio, dry conditions and active wind."
    )
    particle_evidence = [
        {
            "label": "Local PM estimate",
            "value": f"PM2.5 {estimate['pm25']:.1f} · PM10 {estimate['pm10']:.1f} µg/m³",
            "interpretation": estimate["method"],
            "source": frame.sources.air_quality,
        },
        {
            "label": "Coarse/fine ratio",
            "value": f"{ratio:.2f}",
            "interpretation": particle_interpretation,
            "source": "Calculated from current particulate measurements",
        },
        {
            "label": "Local estimate confidence",
            "value": estimate["confidence"].title(),
            "interpretation": (
                f"Nearest contributing station is {estimate['nearest_station_km']:.1f} km away."
                if estimate["nearest_station_km"] is not None
                else "No geolocated station was available; the state aggregate is shown."
            ),
            "source": "Distance and station-coverage assessment",
        },
    ]

    return {
        "region": name,
        "evidence_mode": evidence_mode,
        "evidence_notice": evidence_notice,
        "coordinate": {"longitude": coordinate[0], "latitude": coordinate[1]},
        "generated_at": frame.generated_at.astimezone(timezone.utc).isoformat(),
        "local_air_quality": {
            "aqi": aqi,
            "category": category,
            "colour": _aqi_colour(aqi),
            "pm25": round(estimate["pm25"], 1),
            "pm10": round(estimate["pm10"], 1),
            "method": estimate["method"],
            "confidence": estimate["confidence"],
            "station_count": estimate["station_count"],
            "nearest_station_km": estimate["nearest_station_km"],
            "stations": estimate["stations"],
        },
        "weather": frame.weather.model_dump(mode="json"),
        "thermal": {
            "nearby_hotspot_count": len(nearby_hotspots),
            "nearby_frp_mw": round(total_nearby_frp, 1),
            "nearest_hotspot_km": round(nearest_hotspot[0], 1) if nearest_hotspot else None,
        },
        "wind_transport": {
            "from_degrees": round(wind_from, 1),
            "from_compass": _compass(wind_from),
            "toward_degrees": round(transport_to, 1),
            "toward_compass": _compass(transport_to),
        },
        "explanations": {
            "heat": heat_evidence,
            "wind": wind_evidence,
            "particles": particle_evidence,
        },
        "health_recommendation": _health_recommendation(aqi),
        "caveats": [
            "Weather values are state-centre observations when OpenWeather is live; otherwise they are explicitly labelled demonstration values.",
            "LGA particulate values are measurements only where a station is present; otherwise they are spatial estimates from the nearest live stations.",
            "A pattern consistent with dust does not establish a source attribution.",
            "FIRMS indicates satellite thermal detections, not ground-level air pollution concentration.",
        ],
        "sources": frame.sources.model_dump(),
    }
