import logging
import os
import socket
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from api import constants, models
from api.database import SessionLocal
from api.services.activity_log import log_activity
from api.utils.time import now_local

logger = logging.getLogger(__name__)

# In-memory continuous online tracker:
# Key: device_id (int) -> Value: datetime (when device first observed online)
_device_online_since: Dict[int, datetime] = {}
_device_online_lock = threading.Lock()


def get_offline_threshold_hours() -> float:
    try:
        return float(os.getenv("DEVICE_AUTO_MODE_OFFLINE_HOURS", "48"))
    except ValueError:
        return 48.0


def get_online_threshold_hours() -> float:
    try:
        return float(os.getenv("DEVICE_AUTO_MODE_ONLINE_HOURS", "3"))
    except ValueError:
        return 3.0


def is_auto_mode_switch_enabled() -> bool:
    return os.getenv("DEVICE_AUTO_MODE_SWITCH_ENABLED", "true").lower() in ("true", "1", "yes")


def get_watcher_interval_seconds() -> int:
    try:
        return max(int(os.getenv("DEVICE_WATCHER_INTERVAL_SECONDS", "300")), 10)
    except ValueError:
        return 300


def can_connect(ip_address: str, port: Optional[int] = None) -> bool:
    if port is None:
        port = int(os.getenv("ROBOT_SSH_PORT", "22"))
    timeout = float(os.getenv("DEVICE_STATUS_TIMEOUT_SECONDS", "1.5"))
    try:
        with socket.create_connection((ip_address, port), timeout=timeout):
            return True
    except OSError:
        return False


def _get_system_user_id(db: Session) -> int:
    system_user = db.query(models.User).filter(models.User.user_name == "system").first()
    if system_user:
        return system_user.user_id
    admin_user = db.query(models.User).order_by(models.User.user_id).first()
    return admin_user.user_id if admin_user else 1


def reset_device_online_tracker(device_id: int) -> None:
    with _device_online_lock:
        _device_online_since.pop(device_id, None)


def evaluate_and_update_device_mode(
    device: models.Device,
    db: Session,
    now: Optional[datetime] = None,
) -> bool:
    """
    Evaluates whether a device should automatically switch between:
    - Auto backup (auto_backup_enabled = True)
    - Manual only (auto_backup_enabled = False)

    WITHOUT adding any new database table or column.
    Uses existing device.last_seen_at / created_at for offline calculations,
    and in-memory continuous online tracking for online calculations.
    """
    if not is_auto_mode_switch_enabled():
        return False

    if now is None:
        now = now_local()

    offline_hours_limit = get_offline_threshold_hours()
    online_hours_limit = get_online_threshold_hours()
    changed = False

    if device.device_status == constants.DEVICE_STATUS_ONLINE:
        with _device_online_lock:
            if device.device_id not in _device_online_since:
                _device_online_since[device.device_id] = now
            online_since = _device_online_since[device.device_id]

        hours_online = (now - online_since).total_seconds() / 3600.0
        if hours_online >= online_hours_limit and not device.auto_backup_enabled:
            device.auto_backup_enabled = True
            device.updated_at = now
            changed = True
            logger.info(
                "Device %s (ID %s) automatically switched to Auto Backup (online for %.1f hrs >= %.1f hrs)",
                device.device_name,
                device.device_id,
                hours_online,
                online_hours_limit,
            )
            try:
                log_activity(
                    db=db,
                    user_id=_get_system_user_id(db),
                    device_id=device.device_id,
                    backup_id=None,
                    action="auto_mode_switch",
                    activity_status=constants.BACKUP_STATUS_SUCCESS,
                    message=f"ระบบเปลี่ยนสถานะเป็น Auto Backup อัตโนมัติ (ออนไลน์ต่อเนื่องเกิน {int(online_hours_limit) if online_hours_limit.is_integer() else online_hours_limit} ชั่วโมง)",
                )
            except Exception:
                logger.exception("Failed to log activity for auto mode switch (online)")

    elif device.device_status == constants.DEVICE_STATUS_OFFLINE:
        # Reset continuous online tracker since device is offline
        reset_device_online_tracker(device.device_id)

        # Existing fields only: last_seen_at or created_at
        ref_time = device.last_seen_at or device.created_at or now
        hours_offline = (now - ref_time).total_seconds() / 3600.0

        if hours_offline >= offline_hours_limit and device.auto_backup_enabled:
            device.auto_backup_enabled = False
            device.updated_at = now
            changed = True
            logger.info(
                "Device %s (ID %s) automatically switched to Manual mode (offline for %.1f hrs >= %.1f hrs)",
                device.device_name,
                device.device_id,
                hours_offline,
                offline_hours_limit,
            )
            try:
                log_activity(
                    db=db,
                    user_id=_get_system_user_id(db),
                    device_id=device.device_id,
                    backup_id=None,
                    action="auto_mode_switch",
                    activity_status=constants.BACKUP_STATUS_FAILED,
                    message=f"ระบบเปลี่ยนสถานะเป็น Manual อัตโนมัติ (ออฟไลน์เกิน {int(offline_hours_limit) if offline_hours_limit.is_integer() else offline_hours_limit} ชั่วโมง)",
                )
            except Exception:
                logger.exception("Failed to log activity for auto mode switch (offline)")

    return changed


def update_device_status_and_mode(
    device: models.Device,
    online: bool,
    db: Session,
    now: Optional[datetime] = None,
) -> bool:
    if now is None:
        now = now_local()

    device.device_status = constants.DEVICE_STATUS_ONLINE if online else constants.DEVICE_STATUS_OFFLINE
    if online:
        device.last_seen_at = now
    device.updated_at = now

    return evaluate_and_update_device_mode(device, db, now)


def refresh_devices_statuses(
    devices: List[models.Device],
    db: Session,
    max_workers: Optional[int] = None,
) -> None:
    if not devices:
        return

    workers = max_workers or max(1, min(int(os.getenv("DEVICE_STATUS_WORKERS", "16")), len(devices)))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        statuses = list(
            executor.map(
                lambda device: (
                    device.device_id,
                    can_connect(device.ip_address, getattr(device, "ssh_port", None)),
                ),
                devices,
            )
        )

    now = now_local()
    status_by_id = dict(statuses)
    for device in devices:
        online = status_by_id.get(device.device_id, False)
        update_device_status_and_mode(device, online, db, now)

    db.commit()
    for device in devices:
        db.refresh(device)


def device_watcher_loop(
    stop_event: threading.Event,
    interval_seconds: Optional[int] = None,
) -> None:
    if interval_seconds is None:
        interval_seconds = get_watcher_interval_seconds()

    logger.info("Device watcher background loop started (interval=%ss)", interval_seconds)

    if not stop_event.wait(5):
        try:
            with SessionLocal() as db:
                devices = db.query(models.Device).all()
                refresh_devices_statuses(devices, db)
                logger.info("Device watcher initial check completed (%d devices)", len(devices))
        except Exception:
            logger.exception("Device watcher initial check failed")

    while not stop_event.is_set():
        if stop_event.wait(interval_seconds):
            break

        try:
            with SessionLocal() as db:
                devices = db.query(models.Device).all()
                refresh_devices_statuses(devices, db)
        except Exception:
            logger.exception("Device watcher periodic check failed")

    logger.info("Device watcher background loop stopped")
