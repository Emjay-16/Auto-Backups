import json
import os
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path


@dataclass
class AutoCleanupSettings:
    enabled: bool
    older_than_days: int
    interval_hours: int
    keep_latest_per_device: bool


TRUE_VALUES = {"true", "1", "yes", "on"}


def _settings_file() -> Path:
    return Path(os.getenv("AUTO_CLEANUP_SETTINGS_FILE", "storage/config/auto_cleanup_settings.json"))


def _env_settings() -> AutoCleanupSettings:
    return AutoCleanupSettings(
        enabled=os.getenv("AUTO_CLEANUP_ENABLED", "false").lower() in TRUE_VALUES,
        older_than_days=int(os.getenv("AUTO_CLEANUP_OLDER_THAN_DAYS", "30")),
        interval_hours=int(os.getenv("AUTO_CLEANUP_INTERVAL_HOURS", "720")),
        keep_latest_per_device=os.getenv("AUTO_CLEANUP_KEEP_LATEST", "true").lower() in TRUE_VALUES,
    )


def _load_settings() -> AutoCleanupSettings:
    settings = _env_settings()
    path = _settings_file()
    if not path.exists():
        return settings
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return settings

    return AutoCleanupSettings(
        enabled=bool(data.get("enabled", settings.enabled)),
        older_than_days=max(int(data.get("older_than_days", settings.older_than_days)), 1),
        interval_hours=max(int(data.get("interval_hours", settings.interval_hours)), 1),
        keep_latest_per_device=bool(data.get("keep_latest_per_device", settings.keep_latest_per_device)),
    )


def _save_settings(settings: AutoCleanupSettings) -> None:
    path = _settings_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "enabled": settings.enabled,
        "older_than_days": settings.older_than_days,
        "interval_hours": settings.interval_hours,
        "keep_latest_per_device": settings.keep_latest_per_device,
    }
    with tempfile.NamedTemporaryFile("w", delete=False, dir=path.parent, encoding="utf-8") as tmp:
        json.dump(payload, tmp, indent=2)
        tmp.write("\n")
        tmp_path = Path(tmp.name)
    tmp_path.replace(path)


_settings = _load_settings()
_lock = threading.Lock()


def get_auto_cleanup_settings() -> AutoCleanupSettings:
    with _lock:
        return AutoCleanupSettings(
            enabled=_settings.enabled,
            older_than_days=_settings.older_than_days,
            interval_hours=_settings.interval_hours,
            keep_latest_per_device=_settings.keep_latest_per_device,
        )


def update_auto_cleanup_settings(
    enabled: bool = None,
    older_than_days: int = None,
    interval_hours: int = None,
    keep_latest_per_device: bool = None,
) -> AutoCleanupSettings:
    with _lock:
        if enabled is not None:
            _settings.enabled = enabled
        if older_than_days is not None:
            _settings.older_than_days = max(older_than_days, 1)
        if interval_hours is not None:
            _settings.interval_hours = max(interval_hours, 1)
        if keep_latest_per_device is not None:
            _settings.keep_latest_per_device = keep_latest_per_device

        _save_settings(_settings)

        return AutoCleanupSettings(
            enabled=_settings.enabled,
            older_than_days=_settings.older_than_days,
            interval_hours=_settings.interval_hours,
            keep_latest_per_device=_settings.keep_latest_per_device,
        )


def auto_cleanup_loop(stop_event: threading.Event, cleanup_func) -> None:
    while not stop_event.is_set():
        settings = get_auto_cleanup_settings()
        if settings.enabled:
            try:
                cleanup_func(settings)
            except Exception:
                pass

        sleep_seconds = max(settings.interval_hours, 1) * 60 * 60
        stop_event.wait(sleep_seconds)
