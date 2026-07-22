from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from api.database import get_db
from api.errors import api_exception
from api.models import DeviceGroup
from api.schemas import DeviceGroupCreate, DeviceGroupResponse


router = APIRouter(
    prefix="/device-groups",
    tags=["Device Groups"],
)


@router.get("/", response_model=List[DeviceGroupResponse])
def get_device_groups(
    db: Session = Depends(get_db),
):
    groups = db.query(DeviceGroup).order_by(DeviceGroup.group_id).all()
    return groups


@router.get("/{group_id}", response_model=DeviceGroupResponse)
def get_device_group(
    group_id: int,
    db: Session = Depends(get_db),
):
    group = (
        db.query(DeviceGroup)
        .filter(DeviceGroup.group_id == group_id)
        .first()
    )

    if not group:
        raise api_exception(
            404,
            "DEVICE_GROUP_NOT_FOUND",
            "Device group not found",
        )

    return group


@router.post("/", response_model=DeviceGroupResponse)
def create_device_group(
    data: DeviceGroupCreate,
    db: Session = Depends(get_db),
):
    existing_group = (
        db.query(DeviceGroup)
        .filter(DeviceGroup.group_name == data.group_name)
        .first()
    )

    if existing_group:
        raise api_exception(
            400,
            "DEVICE_GROUP_ALREADY_EXISTS",
            "Device group already exists",
        )

    new_group = DeviceGroup(group_name=data.group_name)

    db.add(new_group)
    db.commit()
    db.refresh(new_group)

    return new_group


@router.delete("/{group_id}")
def delete_device_group(
    group_id: int,
    db: Session = Depends(get_db),
):
    group = (
        db.query(DeviceGroup)
        .filter(DeviceGroup.group_id == group_id)
        .first()
    )

    if not group:
        raise api_exception(
            404,
            "DEVICE_GROUP_NOT_FOUND",
            "Device group not found",
        )

    db.delete(group)
    db.commit()

    return {
        "message": "Device group deleted successfully",
    }
