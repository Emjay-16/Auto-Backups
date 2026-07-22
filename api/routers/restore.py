import os
import posixpath
import json
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from api import constants, models, schemas
from api.database import get_db
from api.errors import api_exception
from api.services.activity_log import log_activity
from api.services.device_resolver import resolve_user
from api.services.robot_database import restore_mysql_table_from_json, restore_mysql_table_via_ssh
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
):
    backup = _get_backup_or_404(backup_id, db)
    device = backup.device
    restorer = resolve_user(db, data.restored_by)
    if not device:
        raise api_exception(
            status.HTTP_404_NOT_FOUND,
            "DEVICE_NOT_FOUND",
            "Device not found",
        )

    all_backup_files = (
        db.query(models.BackupFile)
        .filter(models.BackupFile.backup_id == backup.backup_id)
        .all()
    )

    if not all_backup_files:
        raise api_exception(
            status.HTTP_404_NOT_FOUND,
            "BACKUP_FILES_NOT_FOUND",
            "Backup files not found",
        )

    restore_items = _build_restore_items(all_backup_files, data)
    _validate_restore_files_exist(restore_items)

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

    file_restore_items = []
    database_restore_items = []
    for item in restore_items:
        if _is_database_backup_file(item["file"]):
            database_restore_items.append(item)
            continue

        file_restore_items.append(item)
        local_path = Path(item["file"].file_path)
        resolved_target_path = _resolve_restore_target_path(local_path, item["target_path"])
        item["resolved_target_path"] = resolved_target_path

    try:
        for item in database_restore_items:
            result = _restore_database_backup_file(device, Path(item["file"].file_path))
            item["resolved_target_path"] = f"mysql://{result.database}/{result.table}"
            item["result_message"] = f"Restored {result.row_count} row(s) into MySQL"

        if file_restore_items:
            username = os.getenv("ROBOT_SSH_USERNAME")
            password = os.getenv("ROBOT_SSH_PASSWORD")
            port = int(os.getenv("ROBOT_SSH_PORT", "22"))

            if not username or not password:
                raise RuntimeError("SSH username/password are required for file restore")

            upload_files_to_targets(
                host=device.ip_address,
                username=username,
                password=password,
                port=port,
                transfers=[
                    (Path(item["file"].file_path), item["resolved_target_path"])
                    for item in file_restore_items
                ],
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
        raise api_exception(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "RESTORE_FAILED",
            str(exc),
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
        raise api_exception(
            status.HTTP_502_BAD_GATEWAY,
            "SFTP_RESTORE_FAILED",
            message,
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
                message=item.get("result_message", "Restored"),
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
                raise api_exception(
                    status.HTTP_404_NOT_FOUND,
                    "BACKUP_FILE_NOT_FOUND",
                    "Backup file not found in this backup",
                    {"backup_file_id": item.backup_file_id},
                )
            restore_items.append(
                {
                    "file": backup_file,
                    "target_path": item.target_path,
                }
            )

        return restore_items

    if not data.target_path:
        raise api_exception(
            status.HTTP_400_BAD_REQUEST,
            "TARGET_PATH_REQUIRED",
            "target_path is required when items is not provided",
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
            raise api_exception(
                status.HTTP_404_NOT_FOUND,
                "BACKUP_FILE_MISSING_ON_SERVER",
                "Backup file missing on server",
                {"file_path": str(file_path)},
            )


def _is_database_backup_file(backup_file: models.BackupFile) -> bool:
    file_path = Path(backup_file.file_path)
    if file_path.suffix.lower() != ".json":
        return False

    try:
        with file_path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, ValueError):
        return False

    return (
        isinstance(payload, dict)
        and isinstance(payload.get("database"), str)
        and isinstance(payload.get("table"), str)
        and isinstance(payload.get("rows"), list)
    )


def _restore_database_backup_file(device: models.Device, input_path: Path):
    database_name = os.getenv("ROBOT_DB_NAME")
    table_name = os.getenv("ROBOT_DB_TABLE")
    db_username = os.getenv("ROBOT_DB_USER")
    db_password = os.getenv("ROBOT_DB_PASSWORD")
    db_port = int(os.getenv("ROBOT_DB_PORT", "3306"))
    ssh_username = os.getenv("ROBOT_SSH_USERNAME")
    ssh_password = os.getenv("ROBOT_SSH_PASSWORD")
    ssh_port = int(os.getenv("ROBOT_SSH_PORT", "22"))

    if not db_username or not db_password:
        raise RuntimeError("Robot database username/password are required for database restore")

    try:
        return restore_mysql_table_from_json(
            host=device.ip_address,
            port=db_port,
            username=db_username,
            password=db_password,
            database=database_name,
            table=table_name,
            input_path=input_path,
        )
    except Exception as direct_exc:
        if not ssh_username or not ssh_password:
            raise RuntimeError(f"Robot database restore failed: {direct_exc}") from direct_exc

        return restore_mysql_table_via_ssh(
            host=device.ip_address,
            ssh_username=ssh_username,
            ssh_password=ssh_password,
            ssh_port=ssh_port,
            db_username=db_username,
            db_password=db_password,
            db_port=db_port,
            database=database_name,
            table=table_name,
            input_path=input_path,
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
        raise api_exception(
            status.HTTP_404_NOT_FOUND,
            "BACKUP_NOT_FOUND",
            "Backup not found",
        )
    return backup
