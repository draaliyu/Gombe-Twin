from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
STATIC_ROOT = PROJECT_ROOT / "app" / "static"


def test_thermal_dashboard_elements_exist() -> None:
    html = (STATIC_ROOT / "index.html").read_text(encoding="utf-8")
    required_ids = {
        "heat-canvas",
        "thermal-core",
        "thermal-stress",
        "ambient-heat-fill",
        "radiance-fill",
        "frp-heat-fill",
        "exposure-fill",
        "toggle-heat",
        "live-motion-hud",
        "map-heat-hud",
        "toggle-boost",
    }
    for element_id in required_ids:
        assert f'id="{element_id}"' in html


def test_radiant_renderers_are_loaded() -> None:
    app_js = (STATIC_ROOT / "js" / "app.js").read_text(encoding="utf-8")
    dust_js = (STATIC_ROOT / "js" / "dust.js").read_text(encoding="utf-8")
    heat_js = (STATIC_ROOT / "js" / "heat.js").read_text(encoding="utf-8")

    assert 'from "./heat.js' in app_js
    assert "new HeatHazeField" in app_js
    assert "createSparkBurst" in dust_js
    assert "drawStarGlint" in dust_js
    assert "drawAmbientVeil" in heat_js
    assert "drawWavePacket" in heat_js


def test_high_visibility_motion_features_are_loaded() -> None:
    html = (STATIC_ROOT / "index.html").read_text(encoding="utf-8")
    css = (STATIC_ROOT / "css" / "styles.css").read_text(encoding="utf-8")
    app_js = (STATIC_ROOT / "js" / "app.js").read_text(encoding="utf-8")
    wind_js = (STATIC_ROOT / "js" / "wind.js").read_text(encoding="utf-8")

    assert "?v=7.0.0" in html
    assert "V6 CLEAR-MAP LAYOUT + SMART TOWN LABELS" in css
    assert "updateAnimationHud" in app_js
    assert "toggle-boost" in app_js
    assert "drawGlobalRibbons" in wind_js


def test_gombe_only_mask_and_place_labels_are_loaded() -> None:
    html = (STATIC_ROOT / "index.html").read_text(encoding="utf-8")
    app_js = (STATIC_ROOT / "js" / "app.js").read_text(encoding="utf-8")
    css = (STATIC_ROOT / "css" / "styles.css").read_text(encoding="utf-8")

    for element_id in {"state-mask-overlay", "state-mask-path", "state-outline-path", "place-label-layer"}:
        assert f'id="{element_id}"' in html
    assert "createOutsideMaskGeoJson" in app_js
    assert "hideBasemapLabels" in app_js
    assert "pointInBoundary" in app_js
    assert "createPlaceLabels" in app_js
    assert "#place-label-layer" in css


def test_dust_points_scale_with_severity() -> None:
    dust_js = (STATIC_ROOT / "js" / "dust.js").read_text(encoding="utf-8")

    assert "this.severity" in dust_js
    assert "Math.pow(severityRatio, 1.72)" in dust_js
    assert "createPointSprites" in dust_js
    assert "targetHeroCount" in dust_js
    assert "this.severity < 38" in dust_js


def test_clear_map_layout_and_smart_labels_are_loaded() -> None:
    html = (STATIC_ROOT / "index.html").read_text(encoding="utf-8")
    css = (STATIC_ROOT / "css" / "styles.css").read_text(encoding="utf-8")
    app_js = (STATIC_ROOT / "js" / "app.js").read_text(encoding="utf-8")

    assert 'href="/static/favicon.svg?v=7.0.0"' in html
    assert "--map-frame-left" in css
    assert ".gombe-place-marker" in css
    assert ".place-leader" in css
    assert "candidateOffsets" in app_js
    assert "ResizeObserver" in app_js
    assert "maxZoom: 8.95" in app_js


def test_favicon_route_is_declared() -> None:
    main_py = (PROJECT_ROOT / "app" / "main.py").read_text(encoding="utf-8")
    favicon = STATIC_ROOT / "favicon.svg"
    assert '@app.get("/favicon.ico"' in main_py
    assert favicon.exists()
    assert "<svg" in favicon.read_text(encoding="utf-8")
