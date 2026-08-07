import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Optional

from api.services.json_state import JsonStateManager


logger = logging.getLogger(__name__)


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
_settings_changed_event = threading.Event()


def get_auto_backup_settings() -> AutoBackupSettings:
    return _manager.get()


def update_auto_backup_settings(
    enabled: Optional[bool] = None,
    interval_hours: Optional[int] = None,
    zip_output: Optional[bool] = None,
    run_on_startup: Optional[bool] = None,
) -> AutoBackupSettings:
    settings = _manager.update(
        enabled=enabled,
        interval_hours=interval_hours,
        zip_output=zip_output,
        run_on_startup=run_on_startup,
    )
    _settings_changed_event.set()
    return settings


def auto_backup_loop(stop_event: threading.Event, backup_func) -> None:
    first_run = True

    while not stop_event.is_set():
        settings = get_auto_backup_settings()
        if first_run and not settings.run_on_startup:
            first_run = False
            _wait_for_next_auto_backup_tick(stop_event, settings.interval_hours)
            continue

        first_run = False
        if settings.enabled:
            try:
                backup_func(settings)
            except Exception:
                logger.exception("Auto backup background loop failed")

        _wait_for_next_auto_backup_tick(stop_event, settings.interval_hours)


def _wait_for_next_auto_backup_tick(stop_event: threading.Event, interval_hours: int) -> None:
    sleep_until = time.monotonic() + max(interval_hours, 1) * 60 * 60
    while not stop_event.is_set() and time.monotonic() < sleep_until:
        wait_seconds = min(1, max(sleep_until - time.monotonic(), 0))
        if _settings_changed_event.wait(wait_seconds):
            _settings_changed_event.clear()
            break


def pending_backup_loop(stop_event: threading.Event, pending_func) -> None:
    if os.getenv("AUTO_BACKUP_PENDING_ENABLED", "true").lower() != "true":
        return

    interval_minutes = _pending_interval_minutes()
    sleep_seconds = max(interval_minutes, 1) * 60

    while not stop_event.is_set():
        if os.getenv("AUTO_BACKUP_PENDING_ENABLED", "true").lower() != "true":
            stop_event.wait(sleep_seconds)
            continue

        try:
            pending_func()
        except Exception:
            logger.exception("Pending auto backup background loop failed")

        interval_minutes = _pending_interval_minutes()
        sleep_seconds = max(interval_minutes, 1) * 60
        stop_event.wait(sleep_seconds)


def _pending_interval_minutes() -> int:
    raw_value = os.getenv("AUTO_BACKUP_PENDING_INTERVAL_MINUTES", "60")
    try:
        return max(int(raw_value), 1)
    except ValueError:
        logger.exception(
            "Invalid AUTO_BACKUP_PENDING_INTERVAL_MINUTES=%r; using 60 minute(s)",
            raw_value,
        )
        return 60
