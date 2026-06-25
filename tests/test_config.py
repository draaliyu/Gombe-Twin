from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import DEFAULT_GOMBE_BBOX, Settings


def write_env(tmp_path: Path, bbox_value: str) -> Path:
    env_file = tmp_path / ".env"
    env_file.write_text(f"GOMBE_BBOX={bbox_value}\n", encoding="utf-8")
    return env_file


def test_bbox_default_value() -> None:
    settings = Settings(_env_file=None)
    assert settings.gombe_bbox == DEFAULT_GOMBE_BBOX


def test_bbox_accepts_csv_from_dotenv(tmp_path: Path) -> None:
    env_file = write_env(tmp_path, "10.15,9.45,12.35,11.55")
    settings = Settings(_env_file=env_file)
    assert settings.gombe_bbox == (10.15, 9.45, 12.35, 11.55)


def test_bbox_accepts_json_list_from_dotenv(tmp_path: Path) -> None:
    env_file = write_env(tmp_path, "[10.15,9.45,12.35,11.55]")
    settings = Settings(_env_file=env_file)
    assert settings.gombe_bbox == (10.15, 9.45, 12.35, 11.55)


def test_bbox_accepts_parenthesised_tuple_from_dotenv(tmp_path: Path) -> None:
    env_file = write_env(tmp_path, "(10.15,9.45,12.35,11.55)")
    settings = Settings(_env_file=env_file)
    assert settings.gombe_bbox == (10.15, 9.45, 12.35, 11.55)


def test_bbox_rejects_wrong_number_of_values(tmp_path: Path) -> None:
    env_file = write_env(tmp_path, "10.15,9.45,12.35")
    with pytest.raises(ValidationError, match="exactly four values"):
        Settings(_env_file=env_file)


def test_bbox_rejects_reversed_coordinates(tmp_path: Path) -> None:
    env_file = write_env(tmp_path, "12.35,11.55,10.15,9.45")
    with pytest.raises(ValidationError, match="west must be less than east"):
        Settings(_env_file=env_file)
