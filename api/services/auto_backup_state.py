import os
import threading
from dataclasses import dataclass


TRUE_VALUES = {"true", "1", "yes", "on"}


@dataclass
class AutoBackupSettings:
    enabled: bool
    interval_hours: int
    zip_output: bool
    run_on_startup: bool


_settings = AutoBackupSettings(
    enabled=os.getenv("AUTO_BACKUP_ENABLED", "false").lower() in TRUE_VALUES,
    interval_hours=int(os.getenv("AUTO_BACKUP_INTERVAL_HOURS", "168")),
    zip_output=os.getenv("AUTO_BACKUP_ZIP_OUTPUT", "false").lower() in TRUE_VALUES,
    run_on_startup=os.getenv("AUTO_BACKUP_RUN_ON_STARTUP", "false").lower() in TRUE_VALUES,
)
_lock = threading.Lock()


def get_auto_backup_settings() -> AutoBackupSettings:
    with _lock:
        return AutoBackupSettings(
            enabled=_settings.enabled,
            interval_hours=_settings.interval_hours,
            zip_output=_settings.zip_output,
            run_on_startup=_settings.run_on_startup,
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
    interval_minutes = int(os.getenv("AUTO_BACKUP_PENDING_INTERVAL_MINUTES", "60"))
    sleep_seconds = max(interval_minutes, 1) * 60

    while not stop_event.is_set():
        try:
            pending_func()
        except Exception:
            pass

        stop_event.wait(sleep_seconds)
