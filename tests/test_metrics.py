from app.models import AirQualityReading, WeatherReading
from app.services.metrics import calculate_aqi, derive_indicators


def test_aqi_good_range() -> None:
    aqi, category = calculate_aqi(7.0, 40.0)
    assert 0 <= aqi <= 50
    assert category == "Good"


def test_aqi_hazardous_range() -> None:
    aqi, category = calculate_aqi(300.0, 500.0)
    assert aqi >= 300
    assert category in {"Very unhealthy", "Hazardous"}


def test_derived_indicators_are_bounded() -> None:
    weather = WeatherReading(humidity_pct=15, wind_speed_ms=12, wind_gust_ms=17, visibility_m=1800)
    air = AirQualityReading(pm25=150, pm10=300, aqi=250)
    derived = derive_indicators(weather, air, hotspot_count=4)
    assert 0 <= derived.dust_index <= 100
    assert 0 <= derived.health_risk <= 100
    assert 0 <= derived.aviation_risk <= 100
    assert derived.visibility_estimate_km > 0
