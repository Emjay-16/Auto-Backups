import logging
import threading
import time
from dataclasses import dataclass
from typing import Optional

from api.services.json_state import JsonStateManager


logger = logging.getLogger(__name__)


@dataclass
class AutoCleanupSettings:
    enabled: bool
    older_than_days: int
    older_than_hours: int
    interval_hours: int
    keep_latest_per_device: bool


def _coerce_settings(data: dict, settings: AutoCleanupSettings) -> AutoCleanupSettings:
    return AutoCleanupSettings(
        enabled=bool(data.get("enabled", settings.enabled)),
        older_than_days=max(int(data.get("older_than_days", settings.older_than_days)), 1),
        older_than_hours=max(int(data.get("older_than_hours", settings.older_than_hours)), 0),
        interval_hours=max(int(data.get("interval_hours", settings.interval_hours)), 1),
        keep_latest_per_device=bool(data.get("keep_latest_per_device", settings.keep_latest_per_device)),
    )


_manager = JsonStateManager(
    settings_type=AutoCleanupSettings,
    env_file_key="AUTO_CLEANUP_SETTINGS_FILE",
    default_file="storage/config/auto_cleanup_settings.json",
    env_defaults={
        "enabled": False,
        "older_than_days": 30,
        "older_than_hours": 0,
        "interval_hours": 720,
        "keep_latest_per_device": True,
    },
    coerce=_coerce_settings,
)
_settings_changed_event = threading.Event()


def get_auto_cleanup_settings() -> AutoCleanupSettings:
    return _manager.get()


def update_auto_cleanup_settings(
    enabled: Optional[bool] = None,
    older_than_days: Optional[int] = None,
    older_than_hours: Optional[int] = None,
    interval_hours: Optional[int] = None,
    keep_latest_per_device: Optional[bool] = None,
) -> AutoCleanupSettings:
    settings = _manager.update(
        enabled=enabled,
        older_than_days=older_than_days,
        older_than_hours=older_than_hours,
        interval_hours=interval_hours,
        keep_latest_per_device=keep_latest_per_device,
    )
    _settings_changed_event.set()
    return settings


def auto_cleanup_loop(stop_event: threading.Event, cleanup_func) -> None:
    while not stop_event.is_set():
        settings = get_auto_cleanup_settings()
        if settings.enabled:
            try:
                cleanup_func(settings)
            except Exception:
                logger.exception("Auto cleanup background loop failed")

        sleep_until = time.monotonic() + max(settings.interval_hours, 1) * 60 * 60
        while not stop_event.is_set() and time.monotonic() < sleep_until:
            wait_seconds = min(1, max(sleep_until - time.monotonic(), 0))
            if _settings_changed_event.wait(wait_seconds):
                _settings_changed_event.clear()
                break
