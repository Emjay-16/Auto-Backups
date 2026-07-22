import os
import threading
import time
from dataclasses import dataclass


@dataclass
class AutoCleanupSettings:
    enabled: bool
    older_than_days: int
    interval_hours: int
    keep_latest_per_device: bool


_settings = AutoCleanupSettings(
    enabled=os.getenv("AUTO_CLEANUP_ENABLED", "false").lower() in {"true", "1", "yes", "on"},
    older_than_days=int(os.getenv("AUTO_CLEANUP_OLDER_THAN_DAYS", "30")),
    interval_hours=int(os.getenv("AUTO_CLEANUP_INTERVAL_HOURS", "720")),
    keep_latest_per_device=os.getenv("AUTO_CLEANUP_KEEP_LATEST", "true").lower() in {"true", "1", "yes", "on"},
)
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
