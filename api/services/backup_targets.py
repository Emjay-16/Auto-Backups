import json
import os
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from api.path_utils import project_path


_CUSTOM_PATHS_LOCK = threading.Lock()


@dataclass
class CustomBackupPath:
    path: str
    label: str


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
    return [target.path for target in get_custom_auto_backup_targets()]


def get_custom_auto_backup_targets() -> List[CustomBackupPath]:
    data = _read_custom_paths_config()
    paths = data.get("paths", [])
    if not isinstance(paths, list):
        return []

    targets = []
    seen_paths = set()
    for item in paths:
        target = _coerce_custom_path(item)
        if not target or target.path in seen_paths:
            continue
        targets.append(target)
        seen_paths.add(target.path)

    return targets


def get_backup_path_label(path: str, default_label: str) -> str:
    labels = _path_label_overrides()
    return labels.get(path, default_label)


def save_backup_path_label(path: str, label: Optional[str]) -> CustomBackupPath:
    normalized_path = path.strip()
    if not normalized_path:
        raise ValueError("Path is required")

    normalized_label = normalize_path_label(label, normalized_path)
    with _CUSTOM_PATHS_LOCK:
        targets = get_custom_auto_backup_targets()
        labels = _path_label_overrides()
        labels[normalized_path] = normalized_label

        next_targets = [
            CustomBackupPath(path=target.path, label=normalized_label if target.path == normalized_path else target.label)
            for target in targets
        ]
        _write_custom_paths(next_targets, labels)

    return CustomBackupPath(path=normalized_path, label=normalized_label)


def add_custom_auto_backup_path(path: str, label: Optional[str] = None) -> CustomBackupPath:
    normalized_path = normalize_remote_path(path)
    normalized_label = normalize_path_label(label, normalized_path)
    with _CUSTOM_PATHS_LOCK:
        targets = get_custom_auto_backup_targets()
        saved = CustomBackupPath(path=normalized_path, label=normalized_label)
        replaced = False
        next_targets = []
        for target in targets:
            if target.path == normalized_path:
                next_targets.append(saved)
                replaced = True
            else:
                next_targets.append(target)
        if not replaced:
            next_targets.append(saved)
        labels = _path_label_overrides()
        labels[normalized_path] = normalized_label
        _write_custom_paths(next_targets, labels)
    return saved


def delete_custom_auto_backup_path(path: str) -> bool:
    normalized_path = normalize_remote_path(path)
    with _CUSTOM_PATHS_LOCK:
        targets = get_custom_auto_backup_targets()
        if normalized_path not in [target.path for target in targets]:
            return False

        labels = _path_label_overrides()
        labels.pop(normalized_path, None)
        _write_custom_paths([target for target in targets if target.path != normalized_path], labels)
        return True


def normalize_remote_path(path: str) -> str:
    normalized_path = path.strip()
    if not normalized_path:
        raise ValueError("Path is required")
    if not normalized_path.startswith("/"):
        raise ValueError("Remote path must start with /")
    return normalized_path.rstrip("/") if normalized_path != "/" else normalized_path


def normalize_path_label(label: Optional[str], path: str) -> str:
    normalized_label = (label or "").strip()
    if normalized_label:
        return normalized_label

    normalized_path = path.rstrip("/")
    return normalized_path.split("/")[-1] or normalized_path


def unique_paths(paths: List[str]) -> List[str]:
    return list(dict.fromkeys(path.strip() for path in paths if path and path.strip()))


def _extra_paths_from_env() -> List[str]:
    raw_paths = os.getenv("AUTO_BACKUP_EXTRA_PATHS", "")
    return [path.strip() for path in raw_paths.split(",") if path.strip()]


def _custom_paths_file() -> Path:
    return project_path(os.getenv("AUTO_BACKUP_PATHS_FILE", "storage/config/auto_backup_paths.json"))


def _read_custom_paths_config() -> dict:
    config_path = _custom_paths_file()
    if not config_path.exists():
        return {}

    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

    return data if isinstance(data, dict) else {}


def _path_label_overrides() -> dict:
    labels = _read_custom_paths_config().get("labels", {})
    if not isinstance(labels, dict):
        return {}
    return {
        str(path): str(label).strip()
        for path, label in labels.items()
        if str(path).strip() and str(label).strip()
    }


def _coerce_custom_path(item) -> Optional[CustomBackupPath]:
    if isinstance(item, str):
        if not item.startswith("/"):
            return None
        normalized_path = normalize_remote_path(item)
        return CustomBackupPath(path=normalized_path, label=normalize_path_label(None, normalized_path))

    if not isinstance(item, dict):
        return None

    path = item.get("path")
    if not isinstance(path, str) or not path.startswith("/"):
        return None

    normalized_path = normalize_remote_path(path)
    label = item.get("label")
    return CustomBackupPath(
        path=normalized_path,
        label=normalize_path_label(label if isinstance(label, str) else None, normalized_path),
    )


def _write_custom_paths(paths: List[CustomBackupPath], labels: Optional[dict] = None) -> None:
    config_path = _custom_paths_file()
    config_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(
        {
            "paths": [
                {
                    "label": target.label,
                    "path": target.path,
                }
                for target in paths
            ]
        },
        indent=2,
    )
    payload_data = json.loads(payload)
    if labels:
        payload_data["labels"] = labels
    payload = json.dumps(payload_data, indent=2)

    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=config_path.parent,
        delete=False,
    ) as temp_file:
        temp_file.write(payload)
        temp_name = temp_file.name

    Path(temp_name).replace(config_path)
