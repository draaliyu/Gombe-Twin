from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from app.models import TelemetryFrame
from app.services.weather_insights import build_weather_insight


ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "app" / "static"


def test_weather_insight_uses_current_and_forecast_fields() -> None:
    frame = TelemetryFrame()
    frame.sources.weather = "OpenWeather live"
    frame.sources.air_quality = "OpenAQ v3 live"
    frame.weather.temperature_c = 31.0
    frame.weather.cloud_cover_pct = 72.0
    frame.weather.precipitation_mm_1h = 1.2
    frame.weather.wind_speed_ms = 6.0
    frame.weather.wind_direction_deg = 45.0
    frame.weather.humidity_pct = 68.0
    forecast = [
        {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "temperature_c": 29.5,
            "humidity_pct": 74.0,
            "pressure_hpa": 1009.0,
            "wind_speed_ms": 7.0,
            "wind_direction_deg": 60.0,
            "cloud_cover_pct": 88.0,
            "precipitation_probability_pct": 80.0,
            "precipitation_mm_3h": 4.5,
            "snow_mm_3h": 0.0,
        }
    ]
    insight = build_weather_insight(frame, forecast, datetime.now(timezone.utc).isoformat())
    assert insight["provider_live"] is True
    assert insight["visual_state"]["condition_group"]
    assert insight["visual_state"]["forecast_rain_probability_pct"] == 80.0
    assert insight["current_interpretations"]
    assert insight["forecast_interpretations"]
    assert "not direct video" in insight["visualisation_notice"]
    assert "do not prove" in insight["air_quality_context"]["interpretation"]


def test_weather_page_has_live_map_sky_and_interpretation_controls() -> None:
    html = (STATIC / "weather.html").read_text(encoding="utf-8")
    js = (STATIC / "js" / "weather-page.js").read_text(encoding="utf-8")
    css = (STATIC / "css" / "portal.css").read_text(encoding="utf-8")
    for element_id in {
        "weather-sky-canvas",
        "weather-radar-map",
        "weather-map-flow",
        "weather-current-insights",
        "weather-forecast-insights",
        "weather-air-context",
        "weather-map-fullscreen",
    }:
        assert f'id="{element_id}"' in html
    assert 'data-weather-layer="precipitation"' in html
    assert "class WeatherSkyRenderer" in js
    assert "class WeatherMapFlowRenderer" in js
    assert "/api/weather/tiles/" in js
    assert ".portal-atmosphere-canvas" in css
    assert ".weather-map-frame" in css


def test_weather_routes_and_tile_proxy_are_declared() -> None:
    main = (ROOT / "app" / "main.py").read_text(encoding="utf-8")
    assert '@app.get("/api/weather/insight")' in main
    assert '@app.get("/api/weather/layers")' in main
    assert '@app.get("/api/weather/tiles/{layer}/{z}/{x}/{y}.png"' in main
    assert "WEATHER_TILE_LAYERS" in main
    assert "build_weather_insight" in main


def test_all_service_pages_receive_live_atmosphere() -> None:
    portal = (STATIC / "js" / "portal.js").read_text(encoding="utf-8")
    assert "class PortalAtmosphere" in portal
    assert 'new CustomEvent("gombe:live-frame"' in portal
    assert 'document.querySelector(".portal-atmosphere-shell")' in portal
