from typing import Optional

from sqlalchemy.orm import Session

from api import models
from api.utils.time import now_local


def log_activity(
    db: Session,
    user_id: int,
    device_id: int,
    backup_id: Optional[int],
    action: str,
    activity_status: int,
    message: str,
) -> None:
    db.add(
        models.ActivityLog(
            user_id=user_id,
            device_id=device_id,
            backup_id=backup_id,
            action=action,
            activity_status=activity_status,
            activity_message=message,
            created_at=now_local(),
        )
    )
