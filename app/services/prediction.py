from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any

from app.models import TelemetryFrame
from app.services.metrics import calculate_aqi


FEATURE_NAMES = [
    "temperature_c",
    "humidity_pct",
    "pressure_hpa",
    "wind_speed_ms",
    "wind_direction_sin",
    "wind_direction_cos",
    "cloud_cover_pct",
    "rainfall_mm",
    "previous_pm25",
    "previous_pm10",
    "hour_sin",
    "hour_cos",
]


def _solve_linear_system(matrix: list[list[float]], vector: list[float]) -> list[float]:
    """Solve A*x=b with pivoted Gauss-Jordan elimination."""

    size = len(vector)
    augmented = [list(matrix[row]) + [float(vector[row])] for row in range(size)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-12:
            raise ValueError("The training matrix is singular.")
        if pivot != column:
            augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        augmented[column] = [value / divisor for value in augmented[column]]
        for row in range(size):
            if row == column:
                continue
            factor = augmented[row][column]
            if abs(factor) < 1e-15:
                continue
            augmented[row] = [
                current - factor * pivot_value
                for current, pivot_value in zip(augmented[row], augmented[column])
            ]
    return [augmented[row][-1] for row in range(size)]


def _fit_ridge(features: list[list[float]], targets: list[float], alpha: float = 2.0) -> dict[str, Any]:
    if not features or len(features) != len(targets):
        raise ValueError("Training data are empty or inconsistent.")
    column_count = len(features[0])
    means = [mean(row[index] for row in features) for index in range(column_count)]
    scales = []
    for index in range(column_count):
        variance = mean((row[index] - means[index]) ** 2 for row in features)
        scales.append(max(math.sqrt(variance), 1e-6))

    normalised = [
        [1.0] + [(row[index] - means[index]) / scales[index] for index in range(column_count)]
        for row in features
    ]
    dimensions = column_count + 1
    xtx = [[0.0 for _ in range(dimensions)] for _ in range(dimensions)]
    xty = [0.0 for _ in range(dimensions)]
    for row, target in zip(normalised, targets):
        for left in range(dimensions):
            xty[left] += row[left] * target
            for right in range(dimensions):
                xtx[left][right] += row[left] * row[right]
    for index in range(1, dimensions):
        xtx[index][index] += alpha
    coefficients = _solve_linear_system(xtx, xty)
    return {"means": means, "scales": scales, "coefficients": coefficients}


def _predict_row(model: dict[str, Any], row: list[float]) -> float:
    values = [1.0] + [
        (row[index] - model["means"][index]) / model["scales"][index]
        for index in range(len(row))
    ]
    return sum(coefficient * value for coefficient, value in zip(model["coefficients"], values))


def _metrics(actual: list[float], predicted: list[float]) -> dict[str, float]:
    if not actual:
        return {"mae": 0.0, "rmse": 0.0, "r2": 0.0}
    errors = [prediction - value for value, prediction in zip(actual, predicted)]
    mae = mean(abs(error) for error in errors)
    rmse = math.sqrt(mean(error * error for error in errors))
    target_mean = mean(actual)
    denominator = sum((value - target_mean) ** 2 for value in actual)
    numerator = sum(error * error for error in errors)
    r2 = 1.0 - numerator / denominator if denominator > 1e-12 else 0.0
    return {"mae": round(mae, 3), "rmse": round(rmse, 3), "r2": round(r2, 4)}


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _feature_row(record: dict[str, Any], previous_pm25: float, previous_pm10: float) -> list[float]:
    timestamp = _parse_timestamp(str(record["observed_at"]))
    direction = math.radians(float(record["wind_direction"]))
    hour_angle = 2.0 * math.pi * (timestamp.hour + timestamp.minute / 60.0) / 24.0
    return [
        float(record["temperature"]),
        float(record["humidity"]),
        float(record["pressure"]),
        float(record["wind_speed"]),
        math.sin(direction),
        math.cos(direction),
        float(record["cloud_cover"]),
        float(record["rainfall"]),
        float(previous_pm25),
        float(previous_pm10),
        math.sin(hour_angle),
        math.cos(hour_angle),
    ]


def _forecast_feature_row(
    weather: dict[str, Any],
    previous_pm25: float,
    previous_pm10: float,
) -> list[float]:
    timestamp = _parse_timestamp(str(weather["timestamp"]))
    direction = math.radians(float(weather.get("wind_direction_deg", 0.0)))
    hour_angle = 2.0 * math.pi * (timestamp.hour + timestamp.minute / 60.0) / 24.0
    return [
        float(weather.get("temperature_c", 0.0)),
        float(weather.get("humidity_pct", 0.0)),
        float(weather.get("pressure_hpa", 0.0)),
        float(weather.get("wind_speed_ms", 0.0)),
        math.sin(direction),
        math.cos(direction),
        float(weather.get("cloud_cover_pct", 0.0)),
        float(weather.get("precipitation_mm_3h", 0.0)) / 3.0,
        float(previous_pm25),
        float(previous_pm10),
        math.sin(hour_angle),
        math.cos(hour_angle),
    ]


@dataclass
class TrainingResult:
    status: str
    message: str
    metadata: dict[str, Any]


class AirQualityPredictor:
    """Transparent ridge-regression nowcast trained only on live API observations."""

    def __init__(self, model_path: Path, minimum_samples: int = 24) -> None:
        self.model_path = model_path
        self.minimum_samples = max(12, int(minimum_samples))
        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        self.model: dict[str, Any] | None = None
        self.load()

    def load(self) -> None:
        try:
            self.model = json.loads(self.model_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            self.model = None

    def status(self, observation_stats: dict[str, Any]) -> dict[str, Any]:
        eligible = int(observation_stats.get("eligible_observations", 0))
        return {
            "ready": self.model is not None,
            "admin_training_required": self.model is None,
            "minimum_samples": self.minimum_samples,
            "eligible_samples": eligible,
            "samples_needed": max(0, self.minimum_samples - eligible),
            "model": self.model.get("metadata") if self.model else None,
            "training_rule": "Only rows with live OpenWeather and live OpenAQ provenance are eligible.",
        }

    def train(self, records: list[dict[str, Any]]) -> TrainingResult:
        if len(records) < self.minimum_samples:
            return TrainingResult(
                status="not_ready",
                message=(
                    f"At least {self.minimum_samples} live paired weather/air observations are required; "
                    f"{len(records)} are currently available."
                ),
                metadata={"available_samples": len(records), "minimum_samples": self.minimum_samples},
            )

        features: list[list[float]] = []
        pm25_targets: list[float] = []
        pm10_targets: list[float] = []
        for index in range(1, len(records)):
            previous = records[index - 1]
            current = records[index]
            features.append(_feature_row(current, previous["pm25"], previous["pm10"]))
            pm25_targets.append(float(current["pm25"]))
            pm10_targets.append(float(current["pm10"]))

        split_index = max(8, min(len(features) - 4, int(len(features) * 0.8)))
        train_x = features[:split_index]
        validate_x = features[split_index:]
        train_pm25 = pm25_targets[:split_index]
        validate_pm25 = pm25_targets[split_index:]
        train_pm10 = pm10_targets[:split_index]
        validate_pm10 = pm10_targets[split_index:]

        pm25_validation_model = _fit_ridge(train_x, train_pm25)
        pm10_validation_model = _fit_ridge(train_x, train_pm10)
        pm25_predictions = [_predict_row(pm25_validation_model, row) for row in validate_x]
        pm10_predictions = [_predict_row(pm10_validation_model, row) for row in validate_x]
        pm25_metrics = _metrics(validate_pm25, pm25_predictions)
        pm10_metrics = _metrics(validate_pm10, pm10_predictions)

        trained_at = datetime.now(timezone.utc).isoformat()
        self.model = {
            "version": 1,
            "feature_names": FEATURE_NAMES,
            "pm25_model": _fit_ridge(features, pm25_targets),
            "pm10_model": _fit_ridge(features, pm10_targets),
            "metadata": {
                "algorithm": "Ridge regression with standardised weather, wind, time and lag features",
                "trained_at": trained_at,
                "sample_count": len(features),
                "training_start": records[0]["observed_at"],
                "training_end": records[-1]["observed_at"],
                "validation_count": len(validate_x),
                "pm25_validation": pm25_metrics,
                "pm10_validation": pm10_metrics,
                "provenance": "Paired live OpenWeather and OpenAQ observations stored by this deployment",
            },
        }
        temporary = self.model_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.model, indent=2), encoding="utf-8")
        temporary.replace(self.model_path)
        return TrainingResult(
            status="trained",
            message="The model was retrained from eligible live API observations.",
            metadata=self.model["metadata"],
        )

    def predict(
        self,
        weather_forecast: list[dict[str, Any]],
        latest_frame: TelemetryFrame,
        horizon_steps: int = 8,
    ) -> dict[str, Any]:
        if not self.model:
            return {
                "ready": False,
                "message": "No trained local model is available. An administrator must retrain after enough live observations have accumulated.",
                "forecast": [],
            }
        if not weather_forecast:
            return {
                "ready": False,
                "message": "The local model is trained, but official future weather inputs are currently unavailable.",
                "forecast": [],
            }

        horizon_steps = max(1, min(int(horizon_steps), 16))
        previous_pm25 = float(latest_frame.air_quality.pm25)
        previous_pm10 = float(latest_frame.air_quality.pm10)
        pm25_rmse = float(self.model["metadata"]["pm25_validation"].get("rmse", 0.0))
        pm10_rmse = float(self.model["metadata"]["pm10_validation"].get("rmse", 0.0))
        output: list[dict[str, Any]] = []
        for horizon, weather in enumerate(weather_forecast[:horizon_steps], start=1):
            row = _forecast_feature_row(weather, previous_pm25, previous_pm10)
            pm25 = max(0.0, _predict_row(self.model["pm25_model"], row))
            pm10 = max(pm25, _predict_row(self.model["pm10_model"], row))
            aqi, category = calculate_aqi(pm25, pm10)
            uncertainty_multiplier = 1.0 + 0.16 * max(0, horizon - 1)
            output.append(
                {
                    "timestamp": weather["timestamp"],
                    "pm25": round(pm25, 1),
                    "pm10": round(pm10, 1),
                    "aqi": aqi,
                    "category": category,
                    "pm25_uncertainty": round(pm25_rmse * uncertainty_multiplier, 1),
                    "pm10_uncertainty": round(pm10_rmse * uncertainty_multiplier, 1),
                    "weather_input_source": weather.get("provider", "OpenWeather forecast"),
                }
            )
            previous_pm25 = pm25
            previous_pm10 = pm10
        return {
            "ready": True,
            "message": "Forecast produced by the locally trained model using official weather forecast inputs.",
            "model": self.model["metadata"],
            "forecast": output,
            "warning": "This is an experimental decision-support model, not an official public-health forecast.",
        }
