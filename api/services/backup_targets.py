import json
import os
import tempfile
import threading
from pathlib import Path
from typing import List


_CUSTOM_PATHS_LOCK = threading.Lock()


def get_default_auto_backup_paths() -> List[str]:
    return unique_paths([
        path
        for path in (
            os.getenv("ROBOT_NODE_RED_FLOW_PATH"),
            os.getenv("ROBOT_MAPS_PATH"),
            *_extra_paths_from_env(),
            *get_custom_auto_backup_paths(),
        )
        if path
    ])


def get_custom_auto_backup_paths() -> List[str]:
    config_path = _custom_paths_file()
    if not config_path.exists():
        return []

    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    paths = data.get("paths", [])
    if not isinstance(paths, list):
        return []

    return unique_paths([path for path in paths if isinstance(path, str) and path.startswith("/")])


def add_custom_auto_backup_path(path: str) -> str:
    normalized_path = normalize_remote_path(path)
    with _CUSTOM_PATHS_LOCK:
        paths = get_custom_auto_backup_paths()
        if normalized_path not in paths:
            paths.append(normalized_path)
            _write_custom_paths(paths)
    return normalized_path


def delete_custom_auto_backup_path(path: str) -> bool:
    normalized_path = normalize_remote_path(path)
    with _CUSTOM_PATHS_LOCK:
        paths = get_custom_auto_backup_paths()
        if normalized_path not in paths:
            return False

        _write_custom_paths([saved_path for saved_path in paths if saved_path != normalized_path])
        return True


def normalize_remote_path(path: str) -> str:
    normalized_path = path.strip()
    if not normalized_path:
        raise ValueError("Path is required")
    if not normalized_path.startswith("/"):
        raise ValueError("Remote path must start with /")
    return normalized_path.rstrip("/") if normalized_path != "/" else normalized_path


def unique_paths(paths: List[str]) -> List[str]:
    return list(dict.fromkeys(path.strip() for path in paths if path and path.strip()))


def _extra_paths_from_env() -> List[str]:
    raw_paths = os.getenv("AUTO_BACKUP_EXTRA_PATHS", "")
    return [path.strip() for path in raw_paths.split(",") if path.strip()]


def _custom_paths_file() -> Path:
    return Path(os.getenv("AUTO_BACKUP_PATHS_FILE", "storage/config/auto_backup_paths.json"))


def _write_custom_paths(paths: List[str]) -> None:
    config_path = _custom_paths_file()
    config_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"paths": unique_paths(paths)}, indent=2)

    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=config_path.parent,
        delete=False,
    ) as temp_file:
        temp_file.write(payload)
        temp_name = temp_file.name

    Path(temp_name).replace(config_path)
