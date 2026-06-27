from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.models import TelemetryFrame


def _compass(degrees: float) -> str:
    labels = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
    return labels[round((degrees % 360.0) / 45.0) % 8]


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _condition_group(condition: str) -> str:
    text = condition.casefold()
    if "thunder" in text:
        return "thunderstorm"
    if any(token in text for token in ("rain", "drizzle", "shower")):
        return "rain"
    if any(token in text for token in ("snow", "sleet")):
        return "snow"
    if any(token in text for token in ("mist", "fog", "haze", "smoke", "dust", "sand")):
        return "haze"
    if any(token in text for token in ("cloud", "overcast")):
        return "clouds"
    return "clear"


def _next_forecast(forecast: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not forecast:
        return None
    now = datetime.now(timezone.utc)
    future = []
    for item in forecast:
        try:
            timestamp = datetime.fromisoformat(str(item.get("timestamp", "")).replace("Z", "+00:00"))
        except ValueError:
            continue
        if timestamp >= now:
            future.append((timestamp, item))
    return min(future, key=lambda pair: pair[0])[1] if future else forecast[0]


def build_weather_insight(
    frame: TelemetryFrame,
    forecast: list[dict[str, Any]],
    forecast_updated_at: str | None,
) -> dict[str, Any]:
    weather = frame.weather
    current_source = frame.sources.weather
    weather_live = "openweather" in current_source.casefold()
    next_item = _next_forecast(forecast)
    next_twelve = forecast[:4]

    wind_from = float(weather.wind_direction_deg) % 360.0
    transport_to = (wind_from + 180.0) % 360.0
    rain_now = float(weather.precipitation_mm_1h)
    cloud_now = float(weather.cloud_cover_pct)
    pressure_now = float(weather.pressure_hpa)
    temperature_now = float(weather.temperature_c)
    humidity_now = float(weather.humidity_pct)
    feels_like_now = float(weather.feels_like_c)
    visibility_km = float(weather.visibility_m) / 1000.0

    forecast_rain_total = sum(_number(item.get("precipitation_mm_3h")) for item in next_twelve)
    forecast_snow_total = sum(_number(item.get("snow_mm_3h")) for item in next_twelve)
    max_rain_probability = max(
        (_number(item.get("precipitation_probability_pct")) for item in next_twelve),
        default=0.0,
    )
    max_cloud = max((_number(item.get("cloud_cover_pct")) for item in next_twelve), default=cloud_now)

    if next_item:
        temperature_change = _number(next_item.get("temperature_c"), temperature_now) - temperature_now
        pressure_change = _number(next_item.get("pressure_hpa"), pressure_now) - pressure_now
        wind_change = _number(next_item.get("wind_speed_ms"), weather.wind_speed_ms) - float(weather.wind_speed_ms)
        next_timestamp = next_item.get("timestamp")
    else:
        temperature_change = 0.0
        pressure_change = 0.0
        wind_change = 0.0
        next_timestamp = None

    pm25 = float(frame.air_quality.pm25)
    pm10 = float(frame.air_quality.pm10)
    coarse_fine_ratio = pm10 / max(pm25, 0.1)
    dust_screen_signals = {
        "coarse_particle_ratio_at_least_1_7": coarse_fine_ratio >= 1.7,
        "humidity_below_40_pct": humidity_now < 40.0,
        "no_current_rain_reported": rain_now <= 0.05,
        "wind_at_least_5_ms": float(weather.wind_speed_ms) >= 5.0,
    }
    dust_screen_count = sum(dust_screen_signals.values())

    current_cards = [
        {
            "title": "Sky cover",
            "value": f"{cloud_now:.0f}% cloud cover",
            "interpretation": (
                f"The provider describes the current condition as {weather.condition}. "
                "The animated cloud layer uses the reported cloud percentage; it is a visualisation, not a camera view."
            ),
            "source": current_source,
        },
        {
            "title": "Rain now",
            "value": f"{rain_now:.2f} mm in the latest 1-hour field",
            "interpretation": (
                "The provider reports precipitation in the current observation, so the live rain animation is active."
                if rain_now > 0.0
                else "The provider reports no 1-hour precipitation in the current observation; any forecast rain remains separate from current conditions."
            ),
            "source": current_source,
        },
        {
            "title": "Wind transport",
            "value": f"From {_compass(wind_from)} {wind_from:.0f}° · toward {_compass(transport_to)} {transport_to:.0f}°",
            "interpretation": (
                f"The reported sustained wind is {weather.wind_speed_ms:.1f} m/s. "
                "The animated streamlines move toward the opposite bearing to show possible downwind transport."
            ),
            "source": current_source,
        },
        {
            "title": "Air moisture",
            "value": f"{humidity_now:.0f}% relative humidity",
            "interpretation": (
                "This value controls the density and softness of the cloud and haze animation. "
                "It does not by itself establish that rain is occurring."
            ),
            "source": current_source,
        },
        {
            "title": "Provider feels-like temperature",
            "value": f"{feels_like_now:.1f} °C",
            "interpretation": (
                f"The provider feels-like field differs from the measured air temperature by {feels_like_now - temperature_now:+.1f} °C. "
                "It is a provider-derived comfort estimate, not a separate thermometer reading."
            ),
            "source": current_source,
        },
        {
            "title": "Daylight window",
            "value": (
                f"Sunrise {weather.sunrise_at.astimezone(timezone.utc).strftime('%H:%M')} UTC · sunset {weather.sunset_at.astimezone(timezone.utc).strftime('%H:%M')} UTC"
                if weather.sunrise_at and weather.sunset_at
                else "Not reported"
            ),
            "interpretation": (
                "The sky renderer uses local time to select day or night visual styling. Sunrise and sunset come from the provider when available."
                if weather.sunrise_at and weather.sunset_at
                else "The provider response did not include a complete sunrise and sunset pair."
            ),
            "source": current_source,
        },
        {
            "title": "Visibility",
            "value": (
                f"{visibility_km:.1f} km"
                if weather.visibility_reported
                else "Not reported by the live provider"
            ),
            "interpretation": (
                "The provider included a visibility field in the current observation."
                if weather.visibility_reported
                else "The platform does not present its fallback display value as a live visibility measurement."
            ),
            "source": current_source,
        },
        {
            "title": "Pressure",
            "value": f"{pressure_now:.0f} hPa",
            "interpretation": (
                f"The next provider forecast point changes by {pressure_change:+.1f} hPa relative to the current value. "
                "This is a provider forecast difference, not a claim about a particular weather event."
                if next_item
                else "No provider forecast point is available for a pressure comparison."
            ),
            "source": "Current OpenWeather observation and provider forecast" if weather_live else current_source,
        },
    ]

    forecast_cards = [
        {
            "title": "Next forecast point",
            "value": (
                f"{_number(next_item.get('temperature_c')):.1f} °C · "
                f"{_number(next_item.get('cloud_cover_pct')):.0f}% cloud"
                if next_item
                else "Unavailable"
            ),
            "interpretation": (
                f"Temperature differs from the current observation by {temperature_change:+.1f} °C and wind speed by {wind_change:+.1f} m/s."
                if next_item
                else "The provider forecast endpoint has not returned a usable point."
            ),
            "source": "OpenWeather 5-day / 3-hour forecast" if next_item else "No provider forecast",
        },
        {
            "title": "Next 12 hours: precipitation",
            "value": f"{forecast_rain_total:.2f} mm rain · {forecast_snow_total:.2f} mm snow",
            "interpretation": (
                f"The largest provider precipitation probability in the next four 3-hour points is {max_rain_probability:.0f}%. "
                "The total is a sum of provider 3-hour precipitation fields, not a measured accumulation."
            ),
            "source": "OpenWeather 5-day / 3-hour forecast",
        },
        {
            "title": "Next 12 hours: cloud field",
            "value": f"Up to {max_cloud:.0f}% forecast cloud cover",
            "interpretation": "The sky visual gradually blends toward the forecast cloud field while retaining the current observation as the primary live state.",
            "source": "OpenWeather 5-day / 3-hour forecast",
        },
    ]

    air_interaction = {
        "title": "Weather and particulate context",
        "value": f"PM2.5 {pm25:.1f} · PM10 {pm10:.1f} µg/m³",
        "interpretation": (
            f"An exploratory coarse-dust screen matches {dust_screen_count} of 4 transparent signals: "
            f"PM10/PM2.5 ratio {coarse_fine_ratio:.2f}, humidity {humidity_now:.0f}%, "
            f"rain {rain_now:.2f} mm/h and wind {weather.wind_speed_ms:.1f} m/s. "
            "This screen is descriptive only; the APIs do not prove the particle source."
        ),
        "source": f"{frame.sources.air_quality} + {current_source}",
        "signals": dust_screen_signals,
    }

    return {
        "generated_at": frame.generated_at.astimezone(timezone.utc).isoformat(),
        "forecast_updated_at": forecast_updated_at,
        "mode": frame.mode,
        "source": current_source,
        "provider_live": weather_live,
        "current": weather.model_dump(mode="json"),
        "next_forecast_timestamp": next_timestamp,
        "visual_state": {
            "condition_group": _condition_group(weather.condition),
            "cloud_cover_pct": round(cloud_now, 1),
            "rain_mm_1h": round(rain_now, 3),
            "forecast_rain_probability_pct": round(max_rain_probability, 1),
            "forecast_rain_mm_12h": round(forecast_rain_total, 3),
            "wind_speed_ms": round(float(weather.wind_speed_ms), 2),
            "wind_direction_deg": round(wind_from, 1),
            "transport_direction_deg": round(transport_to, 1),
            "humidity_pct": round(humidity_now, 1),
            "pressure_hpa": round(pressure_now, 1),
            "temperature_c": round(temperature_now, 1),
            "feels_like_c": round(feels_like_now, 1),
            "weather_code": int(weather.weather_code),
            "condition_group_provider": weather.condition_group,
            "visibility_km": round(visibility_km, 2) if weather.visibility_reported else None,
        },
        "current_interpretations": current_cards,
        "forecast_interpretations": forecast_cards,
        "air_quality_context": air_interaction,
        "visualisation_notice": (
            "Cloud, rain, pressure-wave and streamline motion is generated from the current and forecast API fields. "
            "It is an animated interpretation, not direct video of the sky and not a Doppler-radar measurement."
        ),
        "caveats": [
            "Current weather values refer to the configured Gombe reference coordinate, not a separate sensor in every LGA.",
            "Forecast precipitation and cloud values are predictions at 3-hour steps, not observations.",
            "The precipitation map layer is a provider weather tile. The moving flow particles are modelled from reported wind vectors.",
            "Weather context may support an interpretation of particulate behaviour but cannot establish the source of pollution by itself.",
        ],
    }
