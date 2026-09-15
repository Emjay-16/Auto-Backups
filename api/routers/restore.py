import os
import posixpath
import json
import tempfile
import zipfile
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from api import constants, models, schemas
from api.database import get_db
from api.errors import api_exception
from api.path_utils import resolve_backup_file_path
from api.services.activity_log import log_activity
from api.services.device_resolver import resolve_user
from api.services.robot_database import restore_mysql_table_from_json, restore_mysql_table_via_ssh
from api.services.sftp_backup import upload_files_to_targets
from api.services.ssh_credentials import require_ssh_credentials
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
    device = _get_restore_device_or_404(data.device_id, backup, db)
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
    if not restore_items:
        raise api_exception(
            status.HTTP_400_BAD_REQUEST,
            "RESTORE_ITEMS_EMPTY",
            "No restore items were resolved from the request",
        )
    _validate_restore_files_exist(restore_items)

    now = now_local()
    restore_log = models.RestoreLog(
        backup_id=backup.backup_id,
        device_id=device.device_id,
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

    temp_restore_dir = None
    try:
        for item in file_restore_items:
            local_path = resolve_backup_file_path(item["file"].file_path)
            item["resolved_target_path"] = _resolve_restore_target_path(local_path, item["target_path"])

        for item in database_restore_items:
            result = _restore_database_backup_file(device, resolve_backup_file_path(item["file"].file_path))
            item["resolved_target_path"] = f"mysql://{result.database}/{result.table}"
            item["result_message"] = f"Restored {result.row_count} row(s) into MySQL"

        if file_restore_items:
            temp_restore_dir = tempfile.TemporaryDirectory(prefix="restore-zip-")
            username, password, port = require_ssh_credentials(device)

            upload_files_to_targets(
                host=device.ip_address,
                username=username,
                password=password,
                port=port,
                transfers=_build_file_restore_transfers(
                    file_restore_items,
                    Path(temp_restore_dir.name),
                ),
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
    finally:
        if temp_restore_dir:
            temp_restore_dir.cleanup()

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
        device_id=device.device_id,
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
            target_path = item.target_path.strip()
            if not target_path and not _is_database_backup_file(backup_file):
                raise api_exception(
                    status.HTTP_400_BAD_REQUEST,
                    "TARGET_PATH_REQUIRED",
                    "target_path is required for file restore",
                    {"backup_file_id": item.backup_file_id},
                )
            restore_items.append(
                {
                    "file": backup_file,
                    "target_path": target_path,
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
        file_path = resolve_backup_file_path(item["file"].file_path)
        if not file_path.exists():
            raise api_exception(
                status.HTTP_404_NOT_FOUND,
                "BACKUP_FILE_MISSING_ON_SERVER",
                "Backup file missing on server",
                {"file_path": str(file_path)},
            )


def _build_file_restore_transfers(restore_items: List[dict], temp_root: Path):
    transfers = []
    for item in restore_items:
        file_path = resolve_backup_file_path(item["file"].file_path)
        target_path = item["resolved_target_path"]
        if file_path.suffix.lower() != ".zip":
            transfers.append((file_path, target_path))
            continue

        # Check if this zip is a backup bundle archive (contains .auto_backup_manifest.json)
        # Regular user map/sound zip files on the robot should be transferred as-is without extraction
        is_backup_bundle = False
        try:
            with zipfile.ZipFile(file_path) as archive:
                if ".auto_backup_manifest.json" in archive.namelist():
                    is_backup_bundle = True
        except Exception:
            pass

        if not is_backup_bundle:
            transfers.append((file_path, target_path))
            continue

        extracted_files = _extract_restore_zip(file_path, temp_root / file_path.stem)
        if not extracted_files:
            raise RuntimeError(f"Zip backup has no files: {file_path}")

        if len(extracted_files) == 1:
            transfers.append((extracted_files[0], target_path))
            continue

        target_root = target_path.rstrip("/")
        target_name = posixpath.basename(target_root)
        treat_as_file = "." in target_name
        if treat_as_file:
            raise RuntimeError("Restore target must be a directory when zip contains multiple files")

        for extracted_file in extracted_files:
            relative_path = extracted_file.relative_to(temp_root / file_path.stem).as_posix()
            # If relative_path starts with target_name (e.g. relative_path is "maps/file.pgm" and target_root is ".../maps"),
            # strip the leading folder to prevent duplicate folders like .../maps/maps/file.pgm
            if target_name and relative_path.startswith(f"{target_name}/"):
                sub_rel = relative_path[len(target_name) + 1:]
                transfers.append((extracted_file, posixpath.join(target_root, sub_rel)))
            else:
                transfers.append((extracted_file, posixpath.join(target_root, relative_path)))

    return transfers


def _extract_restore_zip(zip_path: Path, extract_root: Path) -> List[Path]:
    extract_root.mkdir(parents=True, exist_ok=True)
    extracted_files = []
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue
            if member.filename == ".auto_backup_manifest.json":
                continue
            member_path = Path(member.filename)
            if member_path.is_absolute() or ".." in member_path.parts:
                raise RuntimeError(f"Unsafe zip member path: {member.filename}")

            output_path = extract_root / member_path
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as source, output_path.open("wb") as target:
                target.write(source.read())
            extracted_files.append(output_path)

    return extracted_files


def _is_database_backup_file(backup_file: models.BackupFile) -> bool:
    file_path = resolve_backup_file_path(backup_file.file_path)
    if file_path.suffix.lower() != ".json":
        return False

    # Check parent folder name
    parent_name = file_path.parent.name.lower()
    if parent_name in {"istuvd.ros_maps", "ros_maps", "istuvd"} or "ros_maps" in file_path.stem.lower():
        return True

    try:
        with file_path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, ValueError):
        return False

    if not isinstance(payload, dict):
        return False

    # Format 1: Full table dump {"database": ..., "table": ..., "rows": [...]}
    if (
        isinstance(payload.get("database"), str)
        and isinstance(payload.get("table"), str)
        and isinstance(payload.get("rows"), list)
    ):
        return True

    # Format 2: Split row file from ros_maps (must NOT be inside maps/ or uploads/ directory)
    parts = [p.lower() for p in file_path.parts]
    if "maps" not in parts and "uploads" not in parts:
        if any(k in payload for k in ("map_data", "canvas_json", "route_list")) or ("name" in payload and "objects" in payload):
            return True

    return False


def _restore_database_backup_file(device: models.Device, input_path: Path):
    database_name = os.getenv("ROBOT_DB_NAME", "istuvd")
    table_name = os.getenv("ROBOT_DB_TABLE", "ros_maps")
    db_username = os.getenv("ROBOT_DB_USER", "istdbUser")
    db_password = os.getenv("ROBOT_DB_PASSWORD", "interface2563")
    db_port = int(os.getenv("ROBOT_DB_PORT", "3306"))
    ssh_username, ssh_password, ssh_port = require_ssh_credentials(device)

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
    normalized_target = target_path.replace("\\", "/").strip()
    if not normalized_target:
        raise RuntimeError("target_path is required for file restore")

    # Safety check: reject server-local paths being sent as a restore destination
    # (e.g. the backup storage path leaking into target_path by mistake) instead of
    # silently guessing a different destination. Guessing meant the write could
    # "succeed" while landing somewhere the user never intended or looked at —
    # this fails loudly instead so the real target_path bug gets fixed at the source.
    if normalized_target.startswith("/home/dev/") or "/storage/backups" in normalized_target:
        raise RuntimeError(
            "target_path looks like a server-local storage path, not a destination on the "
            f"device: {normalized_target!r}. Please provide the actual remote path to restore "
            f"'{local_path.name}' to."
        )

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


def _get_restore_device_or_404(
    device_id: Optional[int],
    backup: models.Backup,
    db: Session,
) -> models.Device:
    if device_id is None:
        if backup.device:
            return backup.device
        raise api_exception(
            status.HTTP_404_NOT_FOUND,
            "DEVICE_NOT_FOUND",
            "Device not found",
        )

    device = (
        db.query(models.Device)
        .filter(models.Device.device_id == device_id)
        .first()
    )
    if not device:
        raise api_exception(
            status.HTTP_404_NOT_FOUND,
            "DEVICE_NOT_FOUND",
            "Destination device not found",
            {"device_id": device_id},
        )
    return device