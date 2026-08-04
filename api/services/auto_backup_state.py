import threading
from dataclasses import dataclass

from api.services.json_state import JsonStateManager


@dataclass
class AutoBackupSettings:
    enabled: bool
    interval_hours: int
    zip_output: bool
    run_on_startup: bool


def _coerce_settings(data: dict, settings: AutoBackupSettings) -> AutoBackupSettings:
    return AutoBackupSettings(
        enabled=bool(data.get("enabled", settings.enabled)),
        interval_hours=max(int(data.get("interval_hours", settings.interval_hours)), 1),
        zip_output=bool(data.get("zip_output", settings.zip_output)),
        run_on_startup=bool(data.get("run_on_startup", settings.run_on_startup)),
    )


_manager = JsonStateManager(
    settings_type=AutoBackupSettings,
    env_file_key="AUTO_BACKUP_SETTINGS_FILE",
    default_file="storage/config/auto_backup_settings.json",
    env_defaults={
        "enabled": False,
        "interval_hours": 168,
        "zip_output": False,
        "run_on_startup": False,
    },
    coerce=_coerce_settings,
)


def get_auto_backup_settings() -> AutoBackupSettings:
    return _manager.get()


def update_auto_backup_settings(
    enabled: bool = None,
    interval_hours: int = None,
    zip_output: bool = None,
    run_on_startup: bool = None,
) -> AutoBackupSettings:
    return _manager.update(
        enabled=enabled,
        interval_hours=interval_hours,
        zip_output=zip_output,
        run_on_startup=run_on_startup,
    )


def auto_backup_loop(stop_event: threading.Event, backup_func) -> None:
    first_run = True

    while not stop_event.is_set():
        settings = get_auto_backup_settings()
        sleep_seconds = max(settings.interval_hours, 1) * 60 * 60

        if first_run and not settings.run_on_startup:
            first_run = False
            stop_event.wait(sleep_seconds)
            continue

        first_run = False
        if settings.enabled:
            try:
                backup_func(settings)
            except Exception:
                pass

        stop_event.wait(sleep_seconds)


def pending_backup_loop(stop_event: threading.Event, pending_func) -> None:
    import os

    interval_minutes = int(os.getenv("AUTO_BACKUP_PENDING_INTERVAL_MINUTES", "60"))
    sleep_seconds = max(interval_minutes, 1) * 60

    while not stop_event.is_set():
        try:
            pending_func()
        except Exception:
            pass

        stop_event.wait(sleep_seconds)