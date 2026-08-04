import threading
from dataclasses import dataclass

from api.services.json_state import JsonStateManager


@dataclass
class AutoCleanupSettings:
    enabled: bool
    older_than_days: int
    interval_hours: int
    keep_latest_per_device: bool


def _coerce_settings(data: dict, settings: AutoCleanupSettings) -> AutoCleanupSettings:
    return AutoCleanupSettings(
        enabled=bool(data.get("enabled", settings.enabled)),
        older_than_days=max(int(data.get("older_than_days", settings.older_than_days)), 1),
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
        "interval_hours": 720,
        "keep_latest_per_device": True,
    },
    coerce=_coerce_settings,
)


def get_auto_cleanup_settings() -> AutoCleanupSettings:
    return _manager.get()


def update_auto_cleanup_settings(
    enabled: bool = None,
    older_than_days: int = None,
    interval_hours: int = None,
    keep_latest_per_device: bool = None,
) -> AutoCleanupSettings:
    return _manager.update(
        enabled=enabled,
        older_than_days=older_than_days,
        interval_hours=interval_hours,
        keep_latest_per_device=keep_latest_per_device,
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