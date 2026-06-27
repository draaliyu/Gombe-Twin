from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.models import AirStation, TelemetryFrame
from app.services.insights import build_region_insight
from app.services.prediction import AirQualityPredictor


def _training_rows(count: int = 40) -> list[dict]:
    start = datetime.now(timezone.utc) - timedelta(hours=8)
    rows = []
    for index in range(count):
        timestamp = start + timedelta(minutes=12 * index)
        rows.append(
            {
                "observed_at": timestamp.isoformat(),
                "temperature": 29.0 + index * 0.03,
                "humidity": 34.0 + index * 0.07,
                "pressure": 1006.0 + index * 0.02,
                "wind_speed": 4.0 + index * 0.04,
                "wind_direction": 35.0 + index,
                "cloud_cover": 12.0 + index * 0.1,
                "rainfall": 0.0,
                "pm25": 28.0 + index * 0.28,
                "pm10": 62.0 + index * 0.55,
            }
        )
    return rows


def test_predictor_trains_and_persists(tmp_path: Path) -> None:
    model_path = tmp_path / "model.json"
    predictor = AirQualityPredictor(model_path, minimum_samples=24)
    result = predictor.train(_training_rows())
    assert result.status == "trained"
    assert model_path.exists()
    assert result.metadata["sample_count"] >= 24
    reloaded = AirQualityPredictor(model_path, minimum_samples=24)
    assert reloaded.model is not None


def test_predictor_rejects_insufficient_live_history(tmp_path: Path) -> None:
    predictor = AirQualityPredictor(tmp_path / "model.json", minimum_samples=24)
    result = predictor.train(_training_rows(10))
    assert result.status == "not_ready"
    assert result.metadata["available_samples"] == 10


def test_region_insight_uses_nearest_station_estimate() -> None:
    frame = TelemetryFrame()
    frame.sources.weather = "OpenWeather live"
    frame.sources.air_quality = "OpenAQ v3 live"
    frame.air_quality.stations = [
        AirStation(id="1", name="Near", latitude=10.29, longitude=11.17, pm25=32, pm10=74),
        AirStation(id="2", name="Far", latitude=10.80, longitude=11.70, pm25=70, pm10=150),
    ]
    feature = {
        "type": "Feature",
        "properties": {"lga_name": "Gombe"},
        "geometry": {"type": "Point", "coordinates": [11.1673, 10.2897]},
    }
    insight = build_region_insight("Gombe", feature, frame)
    assert insight["local_air_quality"]["station_count"] == 2
    assert "Inverse-distance" in insight["local_air_quality"]["method"]
    assert insight["local_air_quality"]["pm25"] < 40
    assert insight["explanations"]["particles"]


def test_live_services_do_not_infer_missing_particulate_values() -> None:
    source = (Path(__file__).resolve().parents[1] / "app" / "services" / "air_quality.py").read_text(encoding="utf-8")
    assert 'if "pm25" not in values or "pm10" not in values' in source
    assert "* 0.45" not in source
    assert "* 2.1" not in source


def test_region_insight_labels_demo_provenance() -> None:
    frame = TelemetryFrame()
    feature = {
        "type": "Feature",
        "properties": {"lga_name": "Gombe"},
        "geometry": {"type": "Point", "coordinates": [11.1673, 10.2897]},
    }
    insight = build_region_insight("Gombe", feature, frame)
    assert insight["evidence_mode"] == "demonstration"
    assert "must not be treated as a measurement" in insight["evidence_notice"]
    assert "Demonstration" in insight["local_air_quality"]["method"]


def test_admin_retraining_guard_requires_configured_secret() -> None:
    from fastapi import HTTPException
    from app.config import Settings
    from app.services.security import AdminGuard

    disabled = AdminGuard(Settings(_env_file=None))
    try:
        disabled.verify("anything", "client")
        assert False, "Disabled admin guard must reject retraining"
    except HTTPException as exc:
        assert exc.status_code == 503

    enabled = AdminGuard(Settings(_env_file=None, admin_password="correct-horse"))
    enabled.verify("correct-horse", "client")
    try:
        enabled.verify("wrong", "client-2")
        assert False, "Wrong administrator password must be rejected"
    except HTTPException as exc:
        assert exc.status_code == 401
