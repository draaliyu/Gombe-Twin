from __future__ import annotations

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


async def fetch_gombe_boundary(client: httpx.AsyncClient) -> dict:
    try:
        metadata_response = await client.get(
            "https://www.geoboundaries.org/api/current/gbOpen/NGA/ADM1/",
            timeout=20.0,
        )
        metadata_response.raise_for_status()
        metadata = metadata_response.json()
        download_url = metadata.get("simplifiedGeometryGeoJSON") or metadata.get("gjDownloadURL")
        if not download_url:
            return FALLBACK_GOMBE

        geometry_response = await client.get(download_url, timeout=30.0, follow_redirects=True)
        geometry_response.raise_for_status()
        collection = geometry_response.json()
        matches = []
        for feature in collection.get("features", []):
            properties = feature.get("properties", {})
            candidate_values = [str(value).lower() for value in properties.values()]
            if any(value == "gombe" or "gombe" in value for value in candidate_values):
                matches.append(feature)

        if matches:
            return {
                "type": "FeatureCollection",
                "name": "Gombe State",
                "features": matches,
            }
    except (httpx.HTTPError, ValueError, TypeError):
        pass

    return FALLBACK_GOMBE
