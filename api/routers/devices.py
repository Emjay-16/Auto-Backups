import ipaddress
import os
import socket
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api import constants, schemas
from api.database import get_db
from api.models import Device, DeviceGroup
from api.security import get_current_user, require_admin
from api.schemas import (
    DeviceCreate,
    DeviceNameResponse,
    DeviceResponse,
    DeviceStatusResponse,
    DeviceUpdate,
    BackupTargetResponse,
    RemoteFileResponse,
)
from api.services.device_resolver import map_device_name
from api.services.sftp_backup import list_remote_path
from api.utils.time import now_local


router = APIRouter(
    prefix="/devices",
    tags=["Devices"],
)


@router.get("/", response_model=List[DeviceResponse])
def get_devices(
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    devices = db.query(Device).order_by(Device.device_id).all()
    return devices


@router.get("/name-by-ip/{ip_address}", response_model=DeviceNameResponse)
def get_device_name_by_ip(ip_address: str):
    try:
        parsed_ip = ipaddress.ip_address(ip_address)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid IP address",
        )

    device_name = map_device_name(str(parsed_ip))
    if device_name == str(parsed_ip):
        raise HTTPException(
            status_code=404,
            detail="Device name cannot be mapped from this IP",
        )

    return DeviceNameResponse(device_name=device_name)


@router.get("/backup-targets", response_model=List[BackupTargetResponse])
def get_backup_targets(_current_user=Depends(get_current_user)):
    targets = []
    flow_path = os.getenv("ROBOT_NODE_RED_FLOW_PATH")
    maps_path = os.getenv("ROBOT_MAPS_PATH")
    db_name = os.getenv("ROBOT_DB_NAME")
    db_table = os.getenv("ROBOT_DB_TABLE")

    if flow_path:
        targets.append(
            BackupTargetResponse(
                key="flows",
                label="Node-RED flows",
                path=flow_path,
                target_type="file",
                browsable=False,
                backup_api="file",
            )
        )

    if maps_path:
        targets.append(
            BackupTargetResponse(
                key="maps",
                label="Maps folder",
                path=maps_path,
                target_type="directory",
                browsable=True,
                backup_api="file",
            )
        )

    if db_name and db_table:
        targets.append(
            BackupTargetResponse(
                key="robot_db",
                label=f"{db_name}.{db_table} -> JSON",
                path=f"{db_name}.{db_table}",
                target_type="database",
                browsable=False,
                backup_api="robot_db",
            )
        )

    return targets


@router.get("/{device_id}/status", response_model=DeviceStatusResponse)
def check_device_status(
    device_id: int,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    device = (
        db.query(Device)
        .filter(Device.device_id == device_id)
        .first()
    )

    if not device:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    online = _can_connect(device.ip_address)
    device.device_status = (
        constants.DEVICE_STATUS_ONLINE
        if online
        else constants.DEVICE_STATUS_OFFLINE
    )
    if online:
        device.last_seen_at = now_local()
    device.updated_at = now_local()
    db.commit()
    db.refresh(device)

    return DeviceStatusResponse(
        device_id=device.device_id,
        ip_address=device.ip_address,
        device_name=device.device_name,
        online=online,
        device_status=device.device_status,
        last_seen_at=device.last_seen_at,
        message="Device is online" if online else "Device is offline",
    )


@router.get("/status-by-ip/{ip_address}", response_model=DeviceStatusResponse)
def check_device_status_by_ip(ip_address: str):
    try:
        parsed_ip = ipaddress.ip_address(ip_address)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid IP address",
        )

    ip_text = str(parsed_ip)
    device_name = map_device_name(ip_text)
    online = _can_connect(ip_text)

    return DeviceStatusResponse(
        ip_address=ip_text,
        device_name=device_name,
        online=online,
        device_status=(
            constants.DEVICE_STATUS_ONLINE
            if online
            else constants.DEVICE_STATUS_OFFLINE
        ),
        last_seen_at=now_local() if online else None,
        message="Device is online" if online else "Device is offline",
    )


@router.get("/{device_id}/files", response_model=List[RemoteFileResponse])
def list_device_files(
    device_id: int,
    path: Optional[str] = None,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    device = _get_device_or_404(device_id, db)
    username = os.getenv("ROBOT_SSH_USERNAME")
    password = os.getenv("ROBOT_SSH_PASSWORD")
    port = int(os.getenv("ROBOT_SSH_PORT", "22"))

    if not username or not password:
        raise HTTPException(
            status_code=500,
            detail="ROBOT_SSH_USERNAME and ROBOT_SSH_PASSWORD are required",
        )

    remote_paths = [path] if path else _default_browse_paths()
    if not remote_paths:
        raise HTTPException(
            status_code=400,
            detail="path is required when default browse paths are not configured",
        )

    files = []
    try:
        for remote_path in remote_paths:
            files.extend(
                list_remote_path(
                    host=device.ip_address,
                    username=username,
                    password=password,
                    port=port,
                    remote_path=remote_path,
                )
            )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )
    except Exception as exc:
        device.device_status = constants.DEVICE_STATUS_OFFLINE
        device.updated_at = now_local()
        db.commit()
        raise HTTPException(
            status_code=502,
            detail=f"SFTP list files failed: {exc}",
        )

    device.device_status = constants.DEVICE_STATUS_ONLINE
    device.last_seen_at = now_local()
    device.updated_at = now_local()
    db.commit()

    return [
        schemas.RemoteFileResponse(
            name=file.name,
            path=file.path,
            file_type=file.file_type,
            size_bytes=file.size_bytes,
            modified_at=file.modified_at,
        )
        for file in files
    ]


@router.get("/{device_id}", response_model=DeviceResponse)
def get_device(
    device_id: int,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    return _get_device_or_404(device_id, db)


@router.post("/", response_model=DeviceResponse)
def create_device(
    data: DeviceCreate,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    group = (
        db.query(DeviceGroup)
        .filter(DeviceGroup.group_id == data.group_id)
        .first()
    )

    if not group:
        raise HTTPException(
            status_code=404,
            detail="Device group not found",
        )

    existing_device = (
        db.query(Device)
        .filter(
            (Device.device_code == data.device_code)
            | (Device.ip_address == data.ip_address)
        )
        .first()
    )

    if existing_device:
        raise HTTPException(
            status_code=400,
            detail="Device code or IP address already exists",
        )

    now = now_local()
    new_device = Device(
        group_id=data.group_id,
        device_code=data.device_code,
        device_name=data.device_name,
        ip_address=data.ip_address,
        device_status=data.device_status,
        last_seen_at=data.last_seen_at,
        created_at=now,
        updated_at=now,
    )

    db.add(new_device)
    db.commit()
    db.refresh(new_device)

    return new_device


@router.put("/{device_id}", response_model=DeviceResponse)
def update_device(
    device_id: int,
    data: DeviceUpdate,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    device = (
        db.query(Device)
        .filter(Device.device_id == device_id)
        .first()
    )

    if not device:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    update_data = {
        field: value
        for field, value in data.model_dump(exclude_unset=True).items()
        if value is not None and value != ""
    }

    if "group_id" in update_data:
        group = (
            db.query(DeviceGroup)
            .filter(DeviceGroup.group_id == update_data["group_id"])
            .first()
        )
        if not group:
            raise HTTPException(
                status_code=404,
                detail="Device group not found",
            )

    if "device_code" in update_data:
        existing_device = (
            db.query(Device)
            .filter(
                Device.device_code == update_data["device_code"],
                Device.device_id != device_id,
            )
            .first()
        )
        if existing_device:
            raise HTTPException(
                status_code=400,
                detail="Device code already exists",
            )

    if "ip_address" in update_data:
        existing_device = (
            db.query(Device)
            .filter(
                Device.ip_address == update_data["ip_address"],
                Device.device_id != device_id,
            )
            .first()
        )
        if existing_device:
            raise HTTPException(
                status_code=400,
                detail="IP address already exists",
            )

    for field, value in update_data.items():
        setattr(device, field, value)

    device.updated_at = now_local()

    db.commit()
    db.refresh(device)

    return device


@router.delete("/{device_id}")
def delete_device(
    device_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    device = (
        db.query(Device)
        .filter(Device.device_id == device_id)
        .first()
    )

    if not device:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    db.delete(device)
    db.commit()

    return {
        "message": "Device deleted successfully",
    }

def _can_connect(ip_address: str) -> bool:
    port = int(os.getenv("ROBOT_SSH_PORT", "22"))
    try:
        with socket.create_connection((ip_address, port), timeout=2):
            return True
    except OSError:
        return False


def _get_device_or_404(device_id: int, db: Session) -> Device:
    device = (
        db.query(Device)
        .filter(Device.device_id == device_id)
        .first()
    )
    if not device:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )
    return device


def _default_browse_paths() -> List[str]:
    return [
        path
        for path in (
            os.getenv("ROBOT_NODE_RED_FLOW_PATH"),
            os.getenv("ROBOT_MAPS_PATH"),
        )
        if path
    ]
