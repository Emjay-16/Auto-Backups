import os
import re
from typing import Optional

from fastapi import status
from sqlalchemy.orm import Session

from api import constants, models
from api.errors import api_exception
from api.utils.time import now_local


def resolve_device(
    db: Session,
    device_id: Optional[int],
    ip_address: Optional[str],
    device_name: Optional[str],
) -> models.Device:
    device = None
    if device_id is not None:
        device = (
            db.query(models.Device)
            .filter(models.Device.device_id == device_id)
            .first()
        )

    ip_text = ip_address or (device.ip_address if device else None)
    if not ip_text:
        raise api_exception(
            status.HTTP_400_BAD_REQUEST,
            "IP_ADDRESS_REQUIRED",
            "ip_address is required when device_id is not found",
        )

    if not device:
        device = (
            db.query(models.Device)
            .filter(models.Device.ip_address == ip_text)
            .first()
        )

    if device:
        return device

    return create_device_from_ip(db, ip_text, device_name or map_device_name(ip_text))


def create_device_from_ip(db: Session, ip_address: str, device_name: str) -> models.Device:
    now = now_local()
    group_name = _device_group_name(device_name)
    group = (
        db.query(models.DeviceGroup)
        .filter(models.DeviceGroup.group_name == group_name)
        .first()
    )
    if not group:
        group = models.DeviceGroup(group_name=group_name)
        db.add(group)
        db.flush()

    device = models.Device(
        group_id=group.group_id,
        device_code=_unique_device_code(db, _device_code(device_name, ip_address)),
        device_name=device_name,
        ip_address=ip_address,
        device_status=constants.DEVICE_STATUS_OFFLINE,
        last_seen_at=None,
        created_at=now,
        updated_at=now,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def resolve_user(db: Session, user_id: Optional[int]) -> models.User:
    if user_id is not None:
        user = (
            db.query(models.User)
            .filter(models.User.user_id == user_id)
            .first()
        )
        if not user:
            raise api_exception(
                status.HTTP_404_NOT_FOUND,
                "USER_NOT_FOUND",
                "User not found",
            )
        return user

    user_name = os.getenv("SYSTEM_USER_NAME", "system")
    user = (
        db.query(models.User)
        .filter(models.User.user_name == user_name)
        .first()
    )
    if user:
        return user

    user = models.User(
        user_name=user_name,
        password=os.getenv("SYSTEM_USER_PASSWORD", "system"),
        role=constants.ROLE_ADMIN,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def map_device_name(ip_address: str) -> str:
    try:
        last_octet = int(ip_address.split(".")[-1])
    except ValueError:
        return ip_address

    if 101 <= last_octet <= 120:
        return f"AMR {last_octet - 100}"
    if 121 <= last_octet <= 140:
        return f"SMR {last_octet - 120}"
    if 141 <= last_octet <= 160:
        return f"SMRL {last_octet - 140}"

    return ip_address


def _device_group_name(device_name: str) -> str:
    group_name = device_name.split(" ", 1)[0].upper()
    return group_name if group_name in {"AMR", "SMR", "SMRL"} else "UNKNOWN"


def _device_code(device_name: str, ip_address: str) -> str:
    match = re.match(r"^(AMR|SMR|SMRL)\s+(\d+)$", device_name, re.IGNORECASE)
    if match:
        return f"{match.group(1).upper()}-{int(match.group(2)):03d}"
    safe_ip = ip_address.replace(".", "-").replace(":", "-")
    return f"AUTO-{safe_ip}"


def _unique_device_code(db: Session, base_code: str) -> str:
    existing = (
        db.query(models.Device)
        .filter(models.Device.device_code == base_code)
        .first()
    )
    if not existing:
        return base_code
    return f"{base_code}-{now_local():%H%M%S}"
