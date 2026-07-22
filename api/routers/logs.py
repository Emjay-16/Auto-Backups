from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from api.database import get_db
from api.errors import api_exception
from api.models import ActivityLog
from api.schemas import ActivityLogResponse


router = APIRouter(
    prefix="/logs",
    tags=["Logs"],
)


@router.get("/", response_model=List[ActivityLogResponse])
def get_activity_logs(
    user_id: Optional[int] = None,
    device_id: Optional[int] = None,
    backup_id: Optional[int] = None,
    action: Optional[str] = None,
    activity_status: Optional[int] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    limit = max(1, min(limit, 500))
    query = db.query(ActivityLog)

    if user_id is not None:
        query = query.filter(ActivityLog.user_id == user_id)
    if device_id is not None:
        query = query.filter(ActivityLog.device_id == device_id)
    if backup_id is not None:
        query = query.filter(ActivityLog.backup_id == backup_id)
    if action:
        query = query.filter(ActivityLog.action == action)
    if activity_status is not None:
        query = query.filter(ActivityLog.activity_status == activity_status)

    return (
        query.order_by(ActivityLog.created_at.desc(), ActivityLog.log_id.desc())
        .limit(limit)
        .all()
    )


@router.get("/{log_id}", response_model=ActivityLogResponse)
def get_activity_log(
    log_id: int,
    db: Session = Depends(get_db),
):
    log = (
        db.query(ActivityLog)
        .filter(ActivityLog.log_id == log_id)
        .first()
    )

    if not log:
        raise api_exception(
            404,
            "ACTIVITY_LOG_NOT_FOUND",
            "Activity log not found",
        )

    return log
