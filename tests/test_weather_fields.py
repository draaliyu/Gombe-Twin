from app.config import Settings
from app.models import WeatherReading
from app.services.simulator import DigitalTwinSimulator


def test_weather_reading_exposes_visual_dashboard_fields() -> None:
    weather = WeatherReading()
    assert 0 <= weather.cloud_cover_pct <= 100
    assert weather.precipitation_mm_1h >= 0
    assert weather.pressure_hpa > 0


def test_simulator_streams_weather_visual_fields() -> None:
    simulator = DigitalTwinSimulator(Settings())
    frame = simulator.next_frame(connected_clients=1)
    assert 0 <= frame.weather.cloud_cover_pct <= 100
    assert frame.weather.precipitation_mm_1h >= 0
    assert frame.connected_clients == 1
