from __future__ import annotations

import math

from app.models import AirQualityReading, DerivedIndicators, WeatherReading


PM25_BREAKPOINTS = [
    (0.0, 9.0, 0, 50),
    (9.1, 35.4, 51, 100),
    (35.5, 55.4, 101, 150),
    (55.5, 125.4, 151, 200),
    (125.5, 225.4, 201, 300),
    (225.5, 325.4, 301, 500),
]

PM10_BREAKPOINTS = [
    (0.0, 54.0, 0, 50),
    (55.0, 154.0, 51, 100),
    (155.0, 254.0, 101, 150),
    (255.0, 354.0, 151, 200),
    (355.0, 424.0, 201, 300),
    (425.0, 604.0, 301, 500),
]


def _sub_index(value: float, breakpoints: list[tuple[float, float, int, int]]) -> int:
    value = max(0.0, value)
    for concentration_low, concentration_high, index_low, index_high in breakpoints:
        if concentration_low <= value <= concentration_high:
            index = (
                (index_high - index_low)
                / (concentration_high - concentration_low)
                * (value - concentration_low)
                + index_low
            )
            return int(round(index))
    return 500


def calculate_aqi(pm25: float, pm10: float) -> tuple[int, str]:
    pm25_index = _sub_index(round(pm25, 1), PM25_BREAKPOINTS)
    pm10_index = _sub_index(float(int(round(pm10))), PM10_BREAKPOINTS)
    aqi = max(pm25_index, pm10_index)
    if aqi <= 50:
        category = "Good"
    elif aqi <= 100:
        category = "Moderate"
    elif aqi <= 150:
        category = "Unhealthy for sensitive groups"
    elif aqi <= 200:
        category = "Unhealthy"
    elif aqi <= 300:
        category = "Very unhealthy"
    else:
        category = "Hazardous"
    return aqi, category


def derive_indicators(weather: WeatherReading, air: AirQualityReading, hotspot_count: int) -> DerivedIndicators:
    dryness = max(0.0, min(1.0, (55.0 - weather.humidity_pct) / 45.0))
    wind_lift = max(0.0, min(1.0, weather.wind_speed_ms / 14.0))
    particulate = max(0.0, min(1.5, air.pm10 / 250.0))
    fire_influence = min(0.25, hotspot_count * 0.025)

    dust_index = max(0.0, min(100.0, 100.0 * (0.48 * particulate + 0.30 * dryness + 0.22 * wind_lift)))
    health_risk = max(0, min(100, int(round(air.aqi / 5.0))))

    visibility_from_pm = 18.0 * math.exp(-air.pm25 / 125.0)
    visibility_api = max(0.3, weather.visibility_m / 1000.0)
    visibility_estimate = max(0.3, min(visibility_api, visibility_from_pm))

    aviation_visibility_penalty = max(0.0, min(1.0, (10.0 - visibility_estimate) / 9.0))
    aviation_wind_penalty = max(0.0, min(1.0, weather.wind_gust_ms / 18.0))
    aviation_risk = max(
        0,
        min(
            100,
            int(round(100 * (0.58 * aviation_visibility_penalty + 0.30 * aviation_wind_penalty + fire_influence))),
        ),
    )

    dispersion_score = max(0.0, min(100.0, 100.0 * (0.72 * wind_lift + 0.28 * (weather.humidity_pct / 100.0))))
    worst_risk = max(health_risk, aviation_risk, int(dust_index))

    if worst_risk >= 80:
        level = "severe"
        message = "Severe dust loading: minimise outdoor exposure and review flight operations."
    elif worst_risk >= 60:
        level = "warning"
        message = "Dust warning: sensitive groups should reduce exposure; aviation visibility may deteriorate."
    elif worst_risk >= 35:
        level = "watch"
        message = "Dust watch: conditions are elevated and may change quickly with wind shifts."
    else:
        level = "normal"
        message = "Conditions are currently within the lower-risk range."

    return DerivedIndicators(
        dust_index=round(dust_index, 1),
        health_risk=health_risk,
        aviation_risk=aviation_risk,
        dispersion_score=round(dispersion_score, 1),
        visibility_estimate_km=round(visibility_estimate, 1),
        alert_level=level,
        alert_message=message,
    )
