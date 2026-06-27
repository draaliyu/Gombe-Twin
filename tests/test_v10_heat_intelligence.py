from __future__ import annotations

from pathlib import Path

from app.models import FireHotspot, TelemetryFrame
from app.services.boundary import FALLBACK_GOMBE_LGAS
from app.services.heat_insights import (
    apparent_temperature_c,
    build_heat_region_insight,
    build_heat_regions,
    build_heat_summary,
)

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "app" / "static"


def _first_lga() -> dict:
    return FALLBACK_GOMBE_LGAS["features"][0]


def test_apparent_temperature_uses_weather_inputs() -> None:
    calm = apparent_temperature_c(34.0, 60.0, 1.0)
    windy = apparent_temperature_c(34.0, 60.0, 8.0)
    assert calm > windy
    assert calm > 34.0


def test_heat_summary_separates_ambient_and_thermal() -> None:
    frame = TelemetryFrame()
    frame.sources.weather = "OpenWeather live"
    frame.sources.firms = "NASA FIRMS live"
    frame.weather.temperature_c = 35.0
    frame.weather.humidity_pct = 55.0
    frame.weather.wind_speed_ms = 3.0
    frame.hotspots = [
        FireHotspot(id="one", latitude=10.3, longitude=11.2, frp=24.0, brightness=335.0)
    ]
    summary = build_heat_summary(FALLBACK_GOMBE_LGAS, frame)
    assert summary["ambient"]["apparent_temperature_c"] > 0
    assert summary["thermal"]["hotspot_count"] == 1
    assert summary["thermal"]["peak_frp_mw"] == 24.0
    assert summary["regions"]["features"]
    assert "displayed separately" in summary["notice"]


def test_heat_region_interpretation_is_source_labelled() -> None:
    frame = TelemetryFrame()
    frame.sources.weather = "OpenWeather live"
    frame.sources.firms = "NASA FIRMS live"
    frame.hotspots = [
        FireHotspot(id="near", latitude=10.35, longitude=11.25, frp=18.0, brightness=330.0)
    ]
    feature = _first_lga()
    name = str(feature.get("properties", {}).get("lga_name", "Gombe"))
    insight = build_heat_region_insight(name, feature, frame)
    assert insight["interpretations"]
    assert insight["attention"]["notice"]
    assert insight["sources"]["firms"] == "NASA FIRMS live"
    assert any("not air temperature" in card["interpretation"] for card in insight["interpretations"])
    assert any("does not identify the cause" in caveat for caveat in insight["caveats"])


def test_heat_regions_have_visual_properties() -> None:
    frame = TelemetryFrame()
    collection = build_heat_regions(FALLBACK_GOMBE_LGAS, frame)
    properties = collection["features"][0]["properties"]
    for key in {
        "ambient_apparent_c",
        "thermal_detection_count",
        "thermal_weighted_frp",
        "attention_score",
        "attention_colour",
    }:
        assert key in properties


def test_heat_page_and_routes_are_declared() -> None:
    html = (STATIC / "heat.html").read_text(encoding="utf-8")
    js = (STATIC / "js" / "heat-page.js").read_text(encoding="utf-8")
    css = (STATIC / "css" / "portal.css").read_text(encoding="utf-8")
    main = (ROOT / "app" / "main.py").read_text(encoding="utf-8")
    for element_id in {
        "heat-sky-canvas",
        "heat-map",
        "heat-aura-canvas",
        "heat-region-select",
        "heat-evidence",
        "heat-map-fullscreen",
    }:
        assert f'id="{element_id}"' in html
    assert "class HeatSkyRenderer" in js
    assert "class HeatAuraRenderer" in js
    assert 'data-heat-mode="thermal"' in html
    assert ".heat-map-frame" in css
    assert '@app.get("/heat"' in main
    assert '@app.get("/api/heat/summary")' in main
    assert '@app.get("/api/heat/regions")' in main
    assert '@app.get("/api/heat/region")' in main
