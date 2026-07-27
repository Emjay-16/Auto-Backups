import json
import os
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path


TRUE_VALUES = {"true", "1", "yes", "on"}


@dataclass
class AutoBackupSettings:
    enabled: bool
    interval_hours: int
    zip_output: bool
    run_on_startup: bool


def _settings_file() -> Path:
    return Path(os.getenv("AUTO_BACKUP_SETTINGS_FILE", "storage/config/auto_backup_settings.json"))


def _env_settings() -> AutoBackupSettings:
    return AutoBackupSettings(
        enabled=os.getenv("AUTO_BACKUP_ENABLED", "false").lower() in TRUE_VALUES,
        interval_hours=int(os.getenv("AUTO_BACKUP_INTERVAL_HOURS", "168")),
        zip_output=os.getenv("AUTO_BACKUP_ZIP_OUTPUT", "false").lower() in TRUE_VALUES,
        run_on_startup=os.getenv("AUTO_BACKUP_RUN_ON_STARTUP", "false").lower() in TRUE_VALUES,
    )


def _load_settings() -> AutoBackupSettings:
    settings = _env_settings()
    path = _settings_file()
    if not path.exists():
        return settings
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return settings

    return AutoBackupSettings(
        enabled=bool(data.get("enabled", settings.enabled)),
        interval_hours=max(int(data.get("interval_hours", settings.interval_hours)), 1),
        zip_output=bool(data.get("zip_output", settings.zip_output)),
        run_on_startup=bool(data.get("run_on_startup", settings.run_on_startup)),
    )


def _save_settings(settings: AutoBackupSettings) -> None:
    path = _settings_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "enabled": settings.enabled,
        "interval_hours": settings.interval_hours,
        "zip_output": settings.zip_output,
        "run_on_startup": settings.run_on_startup,
    }
    with tempfile.NamedTemporaryFile("w", delete=False, dir=path.parent, encoding="utf-8") as tmp:
        json.dump(payload, tmp, indent=2)
        tmp.write("\n")
        tmp_path = Path(tmp.name)
    tmp_path.replace(path)


_settings = _load_settings()
_lock = threading.Lock()


def get_auto_backup_settings() -> AutoBackupSettings:
    with _lock:
        return AutoBackupSettings(
            enabled=_settings.enabled,
            interval_hours=_settings.interval_hours,
            zip_output=_settings.zip_output,
            run_on_startup=_settings.run_on_startup,
        )


def update_auto_backup_settings(
    enabled: bool = None,
    interval_hours: int = None,
    zip_output: bool = None,
    run_on_startup: bool = None,
) -> AutoBackupSettings:
    with _lock:
        if enabled is not None:
            _settings.enabled = enabled
        if interval_hours is not None:
            _settings.interval_hours = max(interval_hours, 1)
        if zip_output is not None:
            _settings.zip_output = zip_output
        if run_on_startup is not None:
            _settings.run_on_startup = run_on_startup

        _save_settings(_settings)

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
