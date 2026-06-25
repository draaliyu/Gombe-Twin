from app.config import Settings
from app.services.simulator import DigitalTwinSimulator


def test_simulator_produces_moving_frames() -> None:
    simulator = DigitalTwinSimulator(Settings())
    first = simulator.next_frame(connected_clients=1)
    second = simulator.next_frame(connected_clients=2)
    assert second.sequence == first.sequence + 1
    assert second.connected_clients == 2
    assert second.weather.wind_speed_ms > 0
    assert len(second.air_quality.stations) >= 1
