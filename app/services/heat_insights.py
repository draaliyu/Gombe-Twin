from __future__ import annotations

import math
from datetime import timezone
from typing import Any

from app.models import FireHotspot, TelemetryFrame
from app.services.insights import representative_point

EARTH_RADIUS_KM = 6371.0088


def _clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return max(minimum, min(maximum, float(value)))


def _haversine_km(left: tuple[float, float], right: tuple[float, float]) -> float:
    lon1, lat1 = map(math.radians, left)
    lon2, lat2 = map(math.radians, right)
    delta_lon = lon2 - lon1
    delta_lat = lat2 - lat1
    value = math.sin(delta_lat / 2.0) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2.0) ** 2
    return 2.0 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(value)))


def _bearing_degrees(origin: tuple[float, float], destination: tuple[float, float]) -> float:
    lon1, lat1 = map(math.radians, origin)
    lon2, lat2 = map(math.radians, destination)
    delta_lon = lon2 - lon1
    x = math.sin(delta_lon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lon)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def _angular_difference(left: float, right: float) -> float:
    return abs((left - right + 180.0) % 360.0 - 180.0)


def _compass(degrees: float) -> str:
    labels = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
    return labels[round((degrees % 360.0) / 45.0) % 8]


def apparent_temperature_c(temperature_c: float, humidity_pct: float, wind_speed_ms: float) -> float:
    """Steadman-style outdoor apparent temperature screening value.

    The calculation combines temperature, water-vapour pressure and wind. It is
    used only as an explanatory screening value; it is not an official local
    heat warning and does not include direct solar radiation.
    """

    temperature = float(temperature_c)
    humidity = _clamp(humidity_pct, 0.0, 100.0)
    wind = max(0.0, float(wind_speed_ms))
    vapour_pressure = (humidity / 100.0) * 6.105 * math.exp(17.27 * temperature / (237.7 + temperature))
    return temperature + 0.33 * vapour_pressure - 0.70 * wind - 4.0


def _ambient_band(apparent_c: float) -> tuple[str, str]:
    if apparent_c < 27.0:
        return "lower", "#55d9a0"
    if apparent_c < 32.0:
        return "elevated", "#f4d45e"
    if apparent_c < 38.0:
        return "high", "#ff963f"
    return "very high", "#ef4f58"


def _anomaly_band(weighted_frp: float, count: int) -> tuple[str, str]:
    if count <= 0 or weighted_frp <= 0.0:
        return "no nearby detection", "#54b7cc"
    if weighted_frp < 5.0:
        return "low", "#f0d34f"
    if weighted_frp < 20.0:
        return "elevated", "#ff963f"
    if weighted_frp < 60.0:
        return "high", "#ef5b47"
    return "very high", "#9d3b8f"


def _hotspot_metrics(coordinate: tuple[float, float], hotspots: list[FireHotspot]) -> dict[str, Any]:
    distances = [
        (_haversine_km(coordinate, (hotspot.longitude, hotspot.latitude)), hotspot)
        for hotspot in hotspots
    ]
    distances.sort(key=lambda item: item[0])
    nearby = [(distance, hotspot) for distance, hotspot in distances if distance <= 75.0]
    weighted_frp = sum(float(hotspot.frp) / (1.0 + (distance / 20.0) ** 2) for distance, hotspot in nearby)
    total_frp = sum(float(hotspot.frp) for _, hotspot in nearby)
    peak_frp = max((float(hotspot.frp) for _, hotspot in nearby), default=0.0)
    nearest = nearby[0] if nearby else (distances[0] if distances else None)
    return {
        "nearby": nearby,
        "count": len(nearby),
        "weighted_frp": weighted_frp,
        "total_frp": total_frp,
        "peak_frp": peak_frp,
        "nearest": nearest,
    }


def _heat_feature(name: str, feature: dict[str, Any], frame: TelemetryFrame) -> dict[str, Any]:
    coordinate = representative_point(feature)
    metrics = _hotspot_metrics(coordinate, frame.hotspots)
    apparent = apparent_temperature_c(
        frame.weather.temperature_c,
        frame.weather.humidity_pct,
        frame.weather.wind_speed_ms,
    )
    ambient_band, ambient_colour = _ambient_band(apparent)
    anomaly_band, anomaly_colour = _anomaly_band(metrics["weighted_frp"], metrics["count"])
    ambient_score = _clamp((apparent - 20.0) / 20.0 * 100.0)
    anomaly_score = _clamp(math.log1p(metrics["weighted_frp"]) / math.log1p(100.0) * 100.0)
    air_score = _clamp(float(frame.air_quality.aqi) / 250.0 * 100.0)
    attention_score = round(0.45 * ambient_score + 0.40 * anomaly_score + 0.15 * air_score, 1)
    properties = dict(feature.get("properties") or {})
    properties.update(
        {
            "lga_name": name,
            "ambient_apparent_c": round(apparent, 1),
            "ambient_heat_band": ambient_band,
            "ambient_colour": ambient_colour,
            "thermal_detection_count": metrics["count"],
            "thermal_weighted_frp": round(metrics["weighted_frp"], 2),
            "thermal_total_frp": round(metrics["total_frp"], 2),
            "thermal_peak_frp": round(metrics["peak_frp"], 2),
            "thermal_anomaly_band": anomaly_band,
            "thermal_colour": anomaly_colour,
            "attention_score": attention_score,
            "attention_colour": _attention_colour(attention_score),
        }
    )
    return {"type": "Feature", "geometry": feature.get("geometry"), "properties": properties}


def _attention_colour(score: float) -> str:
    if score < 25:
        return "#47cfa0"
    if score < 50:
        return "#f0d34f"
    if score < 70:
        return "#ff963f"
    if score < 85:
        return "#ef4f58"
    return "#8c4ab8"


def build_heat_regions(lga_collection: dict[str, Any], frame: TelemetryFrame) -> dict[str, Any]:
    features = []
    for feature in lga_collection.get("features", []):
        properties = feature.get("properties") or {}
        name = str(
            properties.get("lga_name")
            or properties.get("shapeName")
            or properties.get("shape_name")
            or properties.get("name")
            or "Local Government Area"
        )
        features.append(_heat_feature(name, feature, frame))
    return {
        "type": "FeatureCollection",
        "features": features,
        "generated_at": frame.generated_at.astimezone(timezone.utc).isoformat(),
        "mode": frame.mode,
        "sources": frame.sources.model_dump(),
        "notice": (
            "Ambient heat uses the state-centre weather observation for every LGA. Thermal differences are driven only by the location of FIRMS detections; the combined attention score is a transparent visualisation index, not an official warning."
        ),
    }


def build_heat_region_insight(name: str, feature: dict[str, Any], frame: TelemetryFrame) -> dict[str, Any]:
    coordinate = representative_point(feature)
    metrics = _hotspot_metrics(coordinate, frame.hotspots)
    apparent = apparent_temperature_c(
        frame.weather.temperature_c,
        frame.weather.humidity_pct,
        frame.weather.wind_speed_ms,
    )
    ambient_band, ambient_colour = _ambient_band(apparent)
    anomaly_band, anomaly_colour = _anomaly_band(metrics["weighted_frp"], metrics["count"])
    ambient_score = _clamp((apparent - 20.0) / 20.0 * 100.0)
    anomaly_score = _clamp(math.log1p(metrics["weighted_frp"]) / math.log1p(100.0) * 100.0)
    air_score = _clamp(float(frame.air_quality.aqi) / 250.0 * 100.0)
    attention_score = round(0.45 * ambient_score + 0.40 * anomaly_score + 0.15 * air_score, 1)

    nearest = metrics["nearest"]
    wind_from = float(frame.weather.wind_direction_deg) % 360.0
    transport_to = (wind_from + 180.0) % 360.0
    alignment: dict[str, Any] | None = None
    if nearest is not None:
        distance, hotspot = nearest
        hotspot_to_region = _bearing_degrees((hotspot.longitude, hotspot.latitude), coordinate)
        difference = _angular_difference(hotspot_to_region, transport_to)
        if difference <= 35.0:
            label = "aligned"
        elif difference <= 70.0:
            label = "partly aligned"
        else:
            label = "not aligned"
        alignment = {
            "label": label,
            "difference_degrees": round(difference, 1),
            "hotspot_to_region_degrees": round(hotspot_to_region, 1),
            "hotspot_to_region_compass": _compass(hotspot_to_region),
            "transport_toward_degrees": round(transport_to, 1),
            "transport_toward_compass": _compass(transport_to),
            "distance_km": round(distance, 1),
        }

    weather_live = "openweather" in frame.sources.weather.casefold()
    firms_live = "nasa firms" in frame.sources.firms.casefold()
    if metrics["count"]:
        possible_meaning = (
            f"Satellite thermal detections are present within 75 km of {name}. They may represent vegetation fire, open burning or another high-temperature source. "
            "The FIRMS feed identifies thermal anomalies but does not determine the cause without local verification."
        )
    else:
        possible_meaning = (
            f"No FIRMS thermal detection is present within 75 km of {name} in the current feed. The visible heat shading therefore represents the shared state weather context, not evidence of a local fire."
        )

    cards = [
        {
            "title": "Ambient temperature",
            "value": f"{frame.weather.temperature_c:.1f} °C",
            "interpretation": (
                "Current state-centre temperature from OpenWeather. It is applied as shared weather context and is not a direct LGA thermometer reading."
                if weather_live
                else "Demonstration state-centre temperature; a live provider observation is not currently available."
            ),
            "source": frame.sources.weather,
        },
        {
            "title": "Apparent-temperature screen",
            "value": f"{apparent:.1f} °C · {ambient_band.title()}",
            "interpretation": (
                "Calculated from the current temperature, humidity and wind. It is an outdoor comfort screen without direct solar-radiation input, not an official heat warning."
            ),
            "source": "Calculated from current weather fields",
        },
        {
            "title": "Moisture and rainfall",
            "value": f"{frame.weather.humidity_pct:.0f}% humidity · {frame.weather.precipitation_mm_1h:.2f} mm/h rain",
            "interpretation": (
                "Humidity affects apparent temperature, while reported rainfall can cool surfaces and reduce dry fuel or dust. The current fields do not measure soil moisture."
            ),
            "source": frame.sources.weather,
        },
        {
            "title": "Nearby thermal detections",
            "value": f"{metrics['count']} within 75 km · {metrics['total_frp']:.1f} MW total FRP",
            "interpretation": possible_meaning,
            "source": frame.sources.firms,
        },
        {
            "title": "Peak reported FRP",
            "value": f"{metrics['peak_frp']:.1f} MW",
            "interpretation": (
                "Fire radiative power is the satellite-reported radiant energy of a detected thermal source. It is not air temperature and should not be interpreted as temperature in degrees."
            ),
            "source": frame.sources.firms,
        },
    ]
    if alignment is not None:
        cards.append(
            {
                "title": "Wind–hotspot alignment",
                "value": f"{alignment['label'].title()} · {alignment['difference_degrees']:.0f}° difference",
                "interpretation": (
                    f"The nearest detection is {alignment['distance_km']:.1f} km away. The current wind transports air toward "
                    f"{alignment['transport_toward_compass']} while the bearing from the detection toward {name} is "
                    f"{alignment['hotspot_to_region_compass']}. Alignment can indicate possible downwind influence, but it does not prove smoke arrival."
                ),
                "source": f"{frame.sources.weather} + {frame.sources.firms}",
            }
        )

    return {
        "region": name,
        "coordinate": {"longitude": coordinate[0], "latitude": coordinate[1]},
        "generated_at": frame.generated_at.astimezone(timezone.utc).isoformat(),
        "mode": frame.mode,
        "ambient": {
            "temperature_c": round(float(frame.weather.temperature_c), 1),
            "feels_like_provider_c": round(float(frame.weather.feels_like_c), 1),
            "apparent_temperature_c": round(apparent, 1),
            "humidity_pct": round(float(frame.weather.humidity_pct), 1),
            "wind_speed_ms": round(float(frame.weather.wind_speed_ms), 1),
            "rain_mm_1h": round(float(frame.weather.precipitation_mm_1h), 2),
            "band": ambient_band,
            "colour": ambient_colour,
            "score": round(ambient_score, 1),
        },
        "thermal_anomaly": {
            "band": anomaly_band,
            "colour": anomaly_colour,
            "score": round(anomaly_score, 1),
            "nearby_count": metrics["count"],
            "weighted_frp": round(metrics["weighted_frp"], 2),
            "total_frp_mw": round(metrics["total_frp"], 2),
            "peak_frp_mw": round(metrics["peak_frp"], 2),
            "nearest_km": round(nearest[0], 1) if nearest is not None else None,
            "detections": [
                {
                    "id": hotspot.id,
                    "latitude": hotspot.latitude,
                    "longitude": hotspot.longitude,
                    "distance_km": round(distance, 1),
                    "frp_mw": round(float(hotspot.frp), 2),
                    "brightness": round(float(hotspot.brightness), 1),
                    "confidence": hotspot.confidence,
                    "acquired_at": hotspot.acquired_at.astimezone(timezone.utc).isoformat(),
                }
                for distance, hotspot in metrics["nearby"]
            ],
        },
        "attention": {
            "score": attention_score,
            "colour": _attention_colour(attention_score),
            "notice": "A transparent visualisation score combining ambient apparent temperature, distance-weighted FIRMS FRP and current state AQI. It is not an official emergency or fire-risk index.",
        },
        "wind_alignment": alignment,
        "interpretations": cards,
        "possible_meaning": possible_meaning,
        "sources": frame.sources.model_dump(),
        "caveats": [
            "The weather observation is state-centre context unless a local weather station is explicitly shown.",
            "FIRMS detects satellite thermal anomalies; it does not identify the cause of a hotspot.",
            "FRP is radiant power in megawatts, not air temperature.",
            "Wind alignment indicates geometric plausibility only and does not prove smoke transport or exposure.",
            "The combined attention score is a visualisation aid, not an official warning product.",
        ],
    }


def build_heat_summary(lga_collection: dict[str, Any], frame: TelemetryFrame) -> dict[str, Any]:
    regions = build_heat_regions(lga_collection, frame)
    apparent = apparent_temperature_c(
        frame.weather.temperature_c,
        frame.weather.humidity_pct,
        frame.weather.wind_speed_ms,
    )
    ambient_band, ambient_colour = _ambient_band(apparent)
    total_frp = sum(float(hotspot.frp) for hotspot in frame.hotspots)
    peak_frp = max((float(hotspot.frp) for hotspot in frame.hotspots), default=0.0)
    return {
        "generated_at": frame.generated_at.astimezone(timezone.utc).isoformat(),
        "mode": frame.mode,
        "weather_source": frame.sources.weather,
        "firms_source": frame.sources.firms,
        "ambient": {
            "temperature_c": round(float(frame.weather.temperature_c), 1),
            "provider_feels_like_c": round(float(frame.weather.feels_like_c), 1),
            "apparent_temperature_c": round(apparent, 1),
            "humidity_pct": round(float(frame.weather.humidity_pct), 1),
            "wind_speed_ms": round(float(frame.weather.wind_speed_ms), 1),
            "rain_mm_1h": round(float(frame.weather.precipitation_mm_1h), 2),
            "band": ambient_band,
            "colour": ambient_colour,
        },
        "thermal": {
            "hotspot_count": len(frame.hotspots),
            "total_frp_mw": round(total_frp, 2),
            "peak_frp_mw": round(peak_frp, 2),
            "detections": [hotspot.model_dump(mode="json") for hotspot in frame.hotspots],
        },
        "regions": regions,
        "notice": (
            "Ambient heat and satellite thermal anomalies are displayed separately. A bright thermal anomaly does not mean the local air temperature is equally high, and absence of a FIRMS detection does not rule out all heat sources."
        ),
    }
