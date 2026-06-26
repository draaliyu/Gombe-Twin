from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import httpx


FALLBACK_GOMBE = {
    "type": "FeatureCollection",
    "name": "Gombe State approximate fallback boundary",
    "features": [
        {
            "type": "Feature",
            "properties": {"shapeName": "Gombe", "source": "approximate fallback"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [10.37, 10.92], [10.55, 11.34], [10.92, 11.48], [11.28, 11.42],
                    [11.67, 11.23], [11.97, 10.94], [12.16, 10.63], [12.23, 10.28],
                    [12.03, 9.88], [11.72, 9.61], [11.38, 9.50], [11.04, 9.64],
                    [10.79, 9.88], [10.49, 10.13], [10.30, 10.48], [10.37, 10.92]
                ]],
            },
        }
    ],
}


FALLBACK_GOMBE_LGAS = {
    "type": "FeatureCollection",
    "name": "Gombe State LGA representative points",
    "features": [
        {"type": "Feature", "properties": {"shapeName": "Akko", "lga_name": "Akko", "fallback": True}, "geometry": {"type": "Point", "coordinates": [11.0038, 10.2879]}},
        {"type": "Feature", "properties": {"shapeName": "Balanga", "lga_name": "Balanga", "fallback": True}, "geometry": {"type": "Point", "coordinates": [11.6797, 9.9688]}},
        {"type": "Feature", "properties": {"shapeName": "Billiri", "lga_name": "Billiri", "fallback": True}, "geometry": {"type": "Point", "coordinates": [11.2261, 9.8650]}},
        {"type": "Feature", "properties": {"shapeName": "Dukku", "lga_name": "Dukku", "fallback": True}, "geometry": {"type": "Point", "coordinates": [10.7722, 10.8238]}},
        {"type": "Feature", "properties": {"shapeName": "Funakaye", "lga_name": "Funakaye", "fallback": True}, "geometry": {"type": "Point", "coordinates": [11.4322, 10.8534]}},
        {"type": "Feature", "properties": {"shapeName": "Gombe", "lga_name": "Gombe", "fallback": True}, "geometry": {"type": "Point", "coordinates": [11.1673, 10.2897]}},
        {"type": "Feature", "properties": {"shapeName": "Kaltungo", "lga_name": "Kaltungo", "fallback": True}, "geometry": {"type": "Point", "coordinates": [11.3089, 9.8142]}},
        {"type": "Feature", "properties": {"shapeName": "Kwami", "lga_name": "Kwami", "fallback": True}, "geometry": {"type": "Point", "coordinates": [11.0155, 10.4948]}},
        {"type": "Feature", "properties": {"shapeName": "Nafada", "lga_name": "Nafada", "fallback": True}, "geometry": {"type": "Point", "coordinates": [11.3328, 11.0957]}},
        {"type": "Feature", "properties": {"shapeName": "Shongom", "lga_name": "Shongom", "fallback": True}, "geometry": {"type": "Point", "coordinates": [11.1576, 9.6323]}},
        {"type": "Feature", "properties": {"shapeName": "Yamaltu/Deba", "lga_name": "Yamaltu/Deba", "fallback": True}, "geometry": {"type": "Point", "coordinates": [11.3874, 10.2097]}},
    ],
}


def _features(geojson: dict[str, Any]) -> list[dict[str, Any]]:
    if geojson.get("type") == "FeatureCollection":
        return list(geojson.get("features") or [])
    if geojson.get("type") == "Feature":
        return [geojson]
    return []


def _polygons(geojson: dict[str, Any]) -> list[list[list[list[float]]]]:
    polygons: list[list[list[list[float]]]] = []
    for feature in _features(geojson):
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        if geometry.get("type") == "Polygon":
            polygons.append(coordinates)
        elif geometry.get("type") == "MultiPolygon":
            polygons.extend(coordinates)
    return polygons


def _point_in_ring(longitude: float, latitude: float, ring: Iterable[list[float]]) -> bool:
    points = list(ring)
    inside = False
    previous = len(points) - 1
    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[previous]
        intersects = ((y1 > latitude) != (y2 > latitude)) and (
            longitude < ((x2 - x1) * (latitude - y1)) / ((y2 - y1) or 1e-12) + x1
        )
        if intersects:
            inside = not inside
        previous = index
    return inside


def _point_in_boundary(longitude: float, latitude: float, boundary: dict[str, Any]) -> bool:
    for polygon in _polygons(boundary):
        if not polygon or not _point_in_ring(longitude, latitude, polygon[0]):
            continue
        if any(_point_in_ring(longitude, latitude, hole) for hole in polygon[1:]):
            continue
        return True
    return False


def _representative_point(feature: dict[str, Any]) -> tuple[float, float] | None:
    geometry = feature.get("geometry") or {}
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    if geometry_type == "Point" and len(coordinates) >= 2:
        return float(coordinates[0]), float(coordinates[1])
    rings: list[list[list[float]]] = []
    if geometry_type == "Polygon" and coordinates:
        rings = [coordinates[0]]
    elif geometry_type == "MultiPolygon":
        rings = [polygon[0] for polygon in coordinates if polygon]
    points = [point for ring in rings for point in ring if len(point) >= 2]
    if not points:
        return None
    return (
        sum(float(point[0]) for point in points) / len(points),
        sum(float(point[1]) for point in points) / len(points),
    )


def _normalise_lga_feature(feature: dict[str, Any]) -> dict[str, Any]:
    properties = dict(feature.get("properties") or {})
    name = str(
        properties.get("shapeName")
        or properties.get("shape_name")
        or properties.get("NAME_2")
        or properties.get("name")
        or "Local Government Area"
    ).strip()
    properties["shapeName"] = name
    properties["lga_name"] = name
    properties["source"] = "geoBoundaries ADM2"
    return {"type": "Feature", "properties": properties, "geometry": feature.get("geometry")}


async def _download_collection(client: httpx.AsyncClient, administrative_level: str) -> dict[str, Any]:
    metadata_response = await client.get(
        f"https://www.geoboundaries.org/api/current/gbOpen/NGA/{administrative_level}/",
        timeout=20.0,
    )
    metadata_response.raise_for_status()
    metadata = metadata_response.json()
    download_url = metadata.get("simplifiedGeometryGeoJSON") or metadata.get("gjDownloadURL")
    if not download_url:
        raise ValueError(f"No GeoJSON URL returned for {administrative_level}")
    geometry_response = await client.get(download_url, timeout=45.0, follow_redirects=True)
    geometry_response.raise_for_status()
    return geometry_response.json()


async def fetch_gombe_boundary(client: httpx.AsyncClient) -> dict[str, Any]:
    try:
        collection = await _download_collection(client, "ADM1")
        matches = []
        for feature in collection.get("features", []):
            properties = feature.get("properties", {})
            candidate_values = [str(value).lower() for value in properties.values()]
            if any(value == "gombe" or "gombe" in value for value in candidate_values):
                matches.append(feature)
        if matches:
            return {"type": "FeatureCollection", "name": "Gombe State", "features": matches}
    except (httpx.HTTPError, ValueError, TypeError):
        pass
    return FALLBACK_GOMBE


async def fetch_gombe_lgas(client: httpx.AsyncClient, state_boundary: dict[str, Any]) -> dict[str, Any]:
    try:
        collection = await _download_collection(client, "ADM2")
        matches: list[dict[str, Any]] = []
        for feature in collection.get("features", []):
            point = _representative_point(feature)
            if point and _point_in_boundary(point[0], point[1], state_boundary):
                matches.append(_normalise_lga_feature(feature))
        if len(matches) >= 9:
            matches.sort(key=lambda item: str(item.get("properties", {}).get("lga_name", "")))
            return {
                "type": "FeatureCollection",
                "name": "Gombe State Local Government Areas",
                "features": matches,
            }
    except (httpx.HTTPError, ValueError, TypeError):
        pass
    return FALLBACK_GOMBE_LGAS
