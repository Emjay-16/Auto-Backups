import os
import posixpath
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from api import constants, models, schemas
from api.database import get_db
from api.security import require_admin
from api.services.activity_log import log_activity
from api.services.device_resolver import resolve_user
from api.services.sftp_backup import upload_files_to_targets
from api.utils.time import now_local


router = APIRouter(
    prefix="/restore",
    tags=["Restore"],
)


@router.post("/{backup_id}", response_model=schemas.RestoreRunResponse)
def restore_backup(
    backup_id: int,
    data: schemas.RestoreRunRequest,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    backup = _get_backup_or_404(backup_id, db)
    device = backup.device
    restorer = resolve_user(db, data.restored_by)
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found",
        )

    all_backup_files = (
        db.query(models.BackupFile)
        .filter(models.BackupFile.backup_id == backup.backup_id)
        .all()
    )

    if not all_backup_files:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Backup files not found",
        )

    restore_items = _build_restore_items(all_backup_files, data)
    _validate_restore_files_exist(restore_items)

    username = os.getenv("ROBOT_SSH_USERNAME")
    password = os.getenv("ROBOT_SSH_PASSWORD")
    port = int(os.getenv("ROBOT_SSH_PORT", "22"))

    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SSH username/password are required for this device",
        )

    now = now_local()
    restore_log = models.RestoreLog(
        backup_id=backup.backup_id,
        device_id=backup.device_id,
        restored_by=restorer.user_id,
        restore_type=data.restore_type,
        restore_log_status=constants.BACKUP_STATUS_RUNNING,
        restore_message="Restore started",
        restored_at=now,
    )
    db.add(restore_log)
    db.commit()
    db.refresh(restore_log)

    transfers = []
    for item in restore_items:
        local_path = Path(item["file"].file_path)
        resolved_target_path = _resolve_restore_target_path(local_path, item["target_path"])
        item["resolved_target_path"] = resolved_target_path
        transfers.append((local_path, resolved_target_path))

    try:
        upload_files_to_targets(
            host=device.ip_address,
            username=username,
            password=password,
            port=port,
            transfers=transfers,
        )
    except RuntimeError as exc:
        restore_log.restore_log_status = constants.BACKUP_STATUS_FAILED
        restore_log.restore_message = str(exc)
        restore_log.finished_at = now_local()
        log_activity(
            db,
            restorer.user_id,
            device.device_id,
            backup.backup_id,
            "restore",
            constants.BACKUP_STATUS_FAILED,
            str(exc),
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )
    except Exception as exc:
        message = f"SFTP restore failed: {exc}"
        restore_log.restore_log_status = constants.BACKUP_STATUS_FAILED
        restore_log.restore_message = message
        restore_log.finished_at = now_local()
        log_activity(
            db,
            restorer.user_id,
            device.device_id,
            backup.backup_id,
            "restore",
            constants.BACKUP_STATUS_FAILED,
            message,
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=message,
        )

    for item in restore_items:
        file = item["file"]
        db.add(
            models.RestoreItem(
                restore_id=restore_log.restore_id,
                backup_file_id=file.backup_file_id,
                file_name=file.file_name,
                target_path=item["resolved_target_path"],
                restore_item_status=constants.BACKUP_STATUS_SUCCESS,
                message="Restored",
                created_at=now,
            )
        )

    restore_log.restore_log_status = constants.BACKUP_STATUS_SUCCESS
    restore_log.restore_message = "Restore completed"
    restore_log.finished_at = now_local()
    log_activity(
        db,
        restorer.user_id,
        device.device_id,
        backup.backup_id,
        "restore",
        constants.BACKUP_STATUS_SUCCESS,
        "Restore completed",
    )
    db.commit()

    return schemas.RestoreRunResponse(
        restore_id=restore_log.restore_id,
        backup_id=backup.backup_id,
        device_id=backup.device_id,
        total_file=len(restore_items),
        message="Restore completed",
    )


def _build_restore_items(
    backup_files: List[models.BackupFile],
    data: schemas.RestoreRunRequest,
) -> List[dict]:
    if data.items:
        backup_file_by_id = {
            file.backup_file_id: file
            for file in backup_files
        }
        restore_items = []

        for item in data.items:
            backup_file = backup_file_by_id.get(item.backup_file_id)
            if not backup_file:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Backup file not found in this backup: {item.backup_file_id}",
                )
            restore_items.append(
                {
                    "file": backup_file,
                    "target_path": item.target_path,
                }
            )

        return restore_items

    if not data.target_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="target_path is required when items is not provided",
        )

    return [
        {
            "file": file,
            "target_path": data.target_path,
        }
        for file in backup_files
    ]


def _validate_restore_files_exist(restore_items: List[dict]) -> None:
    for item in restore_items:
        file_path = Path(item["file"].file_path)
        if not file_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Backup file missing on server: {file_path}",
            )


def _resolve_restore_target_path(local_path: Path, target_path: str) -> str:
    normalized_target = target_path.replace("\\", "/").rstrip()
    if not normalized_target:
        return local_path.name

    if normalized_target.endswith("/"):
        return posixpath.join(normalized_target, local_path.name)

    target_name = posixpath.basename(normalized_target)
    if "." in target_name or target_name == local_path.name:
        return normalized_target

    return posixpath.join(normalized_target, local_path.name)


def _get_backup_or_404(backup_id: int, db: Session) -> models.Backup:
    backup = (
        db.query(models.Backup)
        .filter(models.Backup.backup_id == backup_id)
        .first()
    )
    if not backup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Backup not found",
        )
    return backup
