import hashlib
import os
import re
import shutil
import tempfile
import threading
import time
import zipfile
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from api import constants, models, schemas
from api.errors import api_exception
from api.services.activity_log import log_activity
from api.services.backup_targets import get_default_auto_backup_paths
from api.services.device_resolver import resolve_device, resolve_user
from api.services.job_service import (
    acquire_job_lock,
    create_job,
    ensure_pending_auto_backup_job,
    is_job_lock_active,
    release_job_lock,
    update_job,
)
from api.services.robot_database import dump_mysql_table_to_json, dump_mysql_table_via_ssh
from api.services.sftp_backup import (
    DownloadedFile,
    RemotePathNotFound,
    RemotePathSnapshot,
    build_backup_directory,
    create_zip_archive,
    download_paths,
    snapshot_remote_path,
)
from api.services.ssh_credentials import require_ssh_credentials
from api.utils.time import now_local


_AUTO_BACKUP_LOCK = threading.Lock()


def get_backup_history(db: Session, limit: int) -> List[schemas.BackupHistoryResponse]:
    limit = max(1, min(limit, 200))
    backups = (
        db.query(models.Backup)
        .order_by(models.Backup.created_at.desc(), models.Backup.backup_id.desc())
        .limit(limit)
        .all()
    )
    return [backup_history_response(backup) for backup in backups]


def get_backup_detail(backup_id: int, db: Session) -> dict:
    backup = get_backup_or_404(backup_id, db)
    response = backup_history_response(backup).model_dump()
    response["files"] = backup.files
    return response


def get_backup_download_zip(backup_id: int, db: Session, file_ids: Optional[List[int]] = None) -> Path:
    backup = get_backup_or_404(backup_id, db)
    query = (
        db.query(models.BackupFile)
        .filter(models.BackupFile.backup_id == backup.backup_id)
    )
    if file_ids:
        query = query.filter(models.BackupFile.backup_file_id.in_(file_ids))
    backup_files = query.order_by(models.BackupFile.backup_file_id).all()

    if not backup_files:
        raise api_exception(
            status.HTTP_404_NOT_FOUND,
            "BACKUP_FILES_NOT_FOUND",
            "Selected backup files not found",
        )

    zip_file = _existing_zip_file(backup_files)
    if zip_file and not file_ids:
        return zip_file

    return _make_download_zip(backup, backup_files, selected=bool(file_ids))


def safe_download_filename(filename: Optional[str], fallback: str) -> str:
    raw_name = (filename or fallback).strip()
    safe_name = re.sub(r"[/\\:*?\"<>|\x00-\x1f]+", "_", raw_name).strip(" ._-")
    if not safe_name:
        safe_name = fallback
    return safe_name if safe_name.lower().endswith(".zip") else f"{safe_name}.zip"


def delete_backup(backup_id: int, db: Session) -> schemas.BackupDeleteResponse:
    backup = get_backup_or_404(backup_id, db)

    backup_files = (
        db.query(models.BackupFile)
        .filter(models.BackupFile.backup_id == backup.backup_id)
        .all()
    )
    deleted_files = _delete_backup_files_from_disk(backup_files)
    _delete_restore_history_for_backup(backup, backup_files, db)

    (
        db.query(models.ActivityLog)
        .filter(models.ActivityLog.backup_id == backup.backup_id)
        .update({"backup_id": None}, synchronize_session=False)
    )

    for backup_file in backup_files:
        db.delete(backup_file)
    db.delete(backup)
    db.commit()

    return schemas.BackupDeleteResponse(
        backup_id=backup_id,
        deleted_files=deleted_files,
        message="Backup deleted successfully",
    )


def cleanup_old_backups(
    data: schemas.BackupCleanupRequest,
    db: Session,
) -> schemas.BackupCleanupResponse:
    cutoff = now_local() - cleanup_age_delta(data)
    backups = (
        db.query(models.Backup)
        .filter(models.Backup.created_at < cutoff)
        .order_by(models.Backup.created_at, models.Backup.backup_id)
        .all()
    )

    items = []
    deleted = 0
    skipped = 0

    for backup in backups:
        reason = _backup_cleanup_skip_reason(
            backup,
            db,
            keep_latest_per_device=data.keep_latest_per_device,
        )
        if reason:
            skipped += 1
            items.append(_cleanup_item(backup, deleted=False, reason=reason))
            continue

        item = _cleanup_item(backup, deleted=True, reason="Deleted")
        delete_backup(backup.backup_id, db)
        deleted += 1
        items.append(item)

    return schemas.BackupCleanupResponse(
        older_than_days=data.older_than_days,
        older_than_hours=data.older_than_hours,
        candidates=len(backups),
        deleted=deleted,
        skipped=skipped,
        items=items,
    )


def cleanup_age_delta(data: schemas.BackupCleanupRequest) -> timedelta:
    if data.older_than_hours is not None and data.older_than_hours > 0:
        return timedelta(hours=data.older_than_hours)
    return timedelta(days=max(data.older_than_days, 1))


def run_file_backup(data: schemas.BackupRunRequest, db: Session) -> schemas.BackupRunResponse:
    device = resolve_device(db, data.device_id, data.ip_address, data.device_name)
    user = resolve_user(db, data.created_by)
    job = create_job(
        db,
        job_type="backup",
        requested_by=user.user_id,
        device_id=device.device_id,
        message="Backup started",
    )
    backup_storage_path = os.getenv("BACKUP_STORAGE_PATH", "storage/backups")

    try:
        username, password, port = require_ssh_credentials()
    except HTTPException:
        update_job(
            db,
            job,
            status=constants.JOB_STATUS_FAILED,
            message="SSH username/password are required for this device",
            finished=True,
        )
        raise

    backup_name = data.backup_name or f"{device.device_name}_{now_local():%Y%m%d_%H%M%S}"
    local_path = build_backup_directory(backup_storage_path, device.device_name)
    backup = _create_backup_record(db, device, user, backup_name, data.backup_type)

    try:
        downloaded_files = download_paths(
            host=device.ip_address,
            username=username,
            password=password,
            port=port,
            remote_paths=data.remote_paths,
            local_root=local_path,
        )

        zip_path = None
        if data.zip_output:
            zip_file = create_zip_archive(local_path, backup_name)
            downloaded_files = [zip_file]
            zip_path = zip_file.local_path

        total_size_mb = _total_size_mb(downloaded_files)
        _finish_backup_success(db, backup, downloaded_files, total_size_mb, "Backup completed")
        _succeed_job(db, job, backup, "Backup completed")
    except RuntimeError as exc:
        _fail_backup_job(db, job, backup, str(exc), "FILE_BACKUP_FAILED", status.HTTP_500_INTERNAL_SERVER_ERROR)
    except Exception as exc:
        message = f"SFTP backup failed: {exc}"
        _fail_backup_job(db, job, backup, message, "SFTP_BACKUP_FAILED", status.HTTP_502_BAD_GATEWAY)

    return schemas.BackupRunResponse(
        backup_id=backup.backup_id,
        backup_name=backup.backup_name,
        device_id=backup.device_id,
        ip_address=device.ip_address,
        device_name=device.device_name,
        total_file=backup.total_file,
        total_size_mb=backup.total_size_mb,
        local_path=str(local_path),
        zip_path=zip_path,
        message="Backup completed",
    )


def run_robot_database_backup(
    data: schemas.RobotDatabaseBackupRequest,
    db: Session,
) -> schemas.BackupRunResponse:
    device = resolve_device(db, data.device_id, data.ip_address, data.device_name)
    user = resolve_user(db, data.created_by)
    job = create_job(
        db,
        job_type="robot_db_backup",
        requested_by=user.user_id,
        device_id=device.device_id,
        message="Robot database backup started",
    )
    backup_storage_path = os.getenv("BACKUP_STORAGE_PATH", "storage/backups")

    database_name = data.database_name or os.getenv("ROBOT_DB_NAME")
    table_name = data.table_name or os.getenv("ROBOT_DB_TABLE")
    username = os.getenv("ROBOT_DB_USER")
    password = os.getenv("ROBOT_DB_PASSWORD")

    if not database_name or not table_name or not username or not password:
        update_job(
            db,
            job,
            status=constants.JOB_STATUS_FAILED,
            message="Database name/table/user/password are required for this device",
            finished=True,
        )
        raise api_exception(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "ROBOT_DATABASE_CONFIG_MISSING",
            "Database name/table/user/password are required for this device",
        )

    backup_name = data.backup_name or f"{device.device_name}_{database_name}_{table_name}_{now_local():%Y%m%d_%H%M%S}"
    local_path = build_backup_directory(backup_storage_path, device.device_name)
    output_path = local_path / f"{database_name}_{table_name}.json"
    backup = _create_backup_record(db, device, user, backup_name, data.backup_type)

    try:
        dumped_file = _dump_robot_database(
            device,
            output_path,
            database_name=database_name,
            table_name=table_name,
        )

        total_size_mb = Decimal(str(round(dumped_file.file_size_mb, 2)))
        _finish_backup_success(db, backup, [dumped_file], total_size_mb, "Robot database backup completed")
        _succeed_job(db, job, backup, "Robot database backup completed")
    except RuntimeError as exc:
        _fail_backup_job(db, job, backup, str(exc), "ROBOT_DATABASE_BACKUP_FAILED", status.HTTP_500_INTERNAL_SERVER_ERROR)
    except Exception as exc:
        message = f"Robot database backup failed: {exc}"
        _fail_backup_job(db, job, backup, message, "ROBOT_DATABASE_BACKUP_FAILED", status.HTTP_502_BAD_GATEWAY)

    return schemas.BackupRunResponse(
        backup_id=backup.backup_id,
        backup_name=backup.backup_name,
        device_id=backup.device_id,
        ip_address=device.ip_address,
        device_name=device.device_name,
        total_file=backup.total_file,
        total_size_mb=backup.total_size_mb,
        local_path=str(local_path),
        zip_path=None,
        message="Robot database backup completed",
    )


def run_combined_backup(
    data: schemas.CombinedBackupRequest,
    db: Session,
) -> schemas.BackupRunResponse:
    device = resolve_device(db, data.device_id, data.ip_address, data.device_name)
    user = resolve_user(db, data.created_by)
    remote_paths = [path for path in data.remote_paths if path]

    if not remote_paths and not data.include_database:
        raise api_exception(
            status.HTTP_400_BAD_REQUEST,
            "BACKUP_TARGET_REQUIRED",
            "Select at least one remote path or database target",
        )

    job = create_job(
        db,
        job_type="combined_backup",
        requested_by=user.user_id,
        device_id=device.device_id,
        message="Combined backup started",
    )

    try:
        database_dump = None
        with tempfile.TemporaryDirectory(prefix="robot-db-combined-") as temp_dir:
            if data.include_database:
                database_path = _configured_robot_database_path(Path(temp_dir))
                if not database_path:
                    raise api_exception(
                        status.HTTP_500_INTERNAL_SERVER_ERROR,
                        "ROBOT_DATABASE_CONFIG_MISSING",
                        "Robot database config is incomplete",
                    )
                database_dump = _dump_robot_database(device, database_path)

            backup = _create_combined_auto_backup(
                db=db,
                device=device,
                created_by=user.user_id,
                remote_paths=remote_paths,
                database_dump=database_dump,
                zip_output=data.zip_output,
                backup_name=data.backup_name,
                backup_type=data.backup_type,
            )

        update_job(
            db,
            job,
            status=constants.JOB_STATUS_SUCCESS,
            backup_id=backup.backup_id,
            total_devices=1,
            checked_devices=1,
            online_devices=1,
            backups_created=1,
            message="Combined backup completed",
            finished=True,
        )

        return schemas.BackupRunResponse(
            backup_id=backup.backup_id,
            backup_name=backup.backup_name,
            device_id=backup.device_id,
            ip_address=device.ip_address,
            device_name=device.device_name,
            total_file=backup.total_file,
            total_size_mb=backup.total_size_mb,
            local_path=str(Path(os.getenv("BACKUP_STORAGE_PATH", "storage/backups")) / device.device_name),
            zip_path=None,
            message="Combined backup completed",
        )
    except HTTPException as exc:
        update_job(
            db,
            job,
            status=constants.JOB_STATUS_FAILED,
            total_devices=1,
            checked_devices=1,
            failed_devices=1,
            message=str(exc.detail),
            finished=True,
        )
        raise
    except Exception as exc:
        message = f"Combined backup failed: {exc}"
        update_job(
            db,
            job,
            status=constants.JOB_STATUS_FAILED,
            total_devices=1,
            checked_devices=1,
            failed_devices=1,
            message=message,
            finished=True,
        )
        raise api_exception(
            status.HTTP_502_BAD_GATEWAY,
            "COMBINED_BACKUP_FAILED",
            message,
        )


def run_auto_backups(data: schemas.AutoBackupRequest, db: Session) -> schemas.AutoBackupResponse:
    max_retries = int(os.getenv("AUTO_BACKUP_MAX_RETRIES", "3"))
    retry_delay_seconds = float(os.getenv("AUTO_BACKUP_RETRY_DELAY_SECONDS", "15"))

    if not _AUTO_BACKUP_LOCK.acquire(blocking=False):
        raise api_exception(
            status.HTTP_409_CONFLICT,
            "AUTO_BACKUP_ALREADY_RUNNING",
            "Auto backup is already running",
        )

    lock_owner = None
    job = None
    try:
        lock_owner = acquire_job_lock(
            db,
            "auto_backup",
            ttl_minutes=int(os.getenv("AUTO_BACKUP_LOCK_MINUTES", "180")),
        )
        if not lock_owner:
            raise api_exception(
                status.HTTP_409_CONFLICT,
                "AUTO_BACKUP_ALREADY_RUNNING",
                "Auto backup is already running",
            )

        job = create_job(
            db,
            job_type="auto_backup",
            requested_by=data.created_by,
            max_retries=max_retries,
            message="Auto backup queued",
        )
        response = _run_auto_backups(data, db, job, max_retries, retry_delay_seconds)
        update_job(
            db,
            job,
            status=_auto_backup_finished_status(response),
            message=_auto_backup_completion_message(response),
            finished=True,
        )
        response.job_id = job.job_id
        return response
    except HTTPException as exc:
        if job and job.job_status == constants.JOB_STATUS_RUNNING:
            update_job(
                db,
                job,
                status=constants.JOB_STATUS_FAILED,
                message=str(exc.detail),
                finished=True,
        )
        raise
    except Exception as exc:
        if job:
            update_job(
                db,
                job,
                status=constants.JOB_STATUS_FAILED,
                message=f"Auto backup failed: {exc}",
                finished=True,
            )
        raise
    finally:
        release_job_lock(db, "auto_backup", lock_owner)
        _AUTO_BACKUP_LOCK.release()


def process_pending_auto_backups(db: Session, limit: int = 20) -> int:
    if is_job_lock_active(db, "auto_backup"):
        return 0

    pending_jobs = (
        db.query(models.BackupJob)
        .filter(
            models.BackupJob.job_type == "auto_backup_pending",
            models.BackupJob.job_status == constants.JOB_STATUS_PENDING,
        )
        .order_by(models.BackupJob.updated_at, models.BackupJob.job_id)
        .limit(max(1, limit))
        .all()
    )
    processed = 0

    for pending_job in pending_jobs:
        if pending_job.device_id is None:
            update_job(
                db,
                pending_job,
                status=constants.JOB_STATUS_FAILED,
                message="Pending auto backup has no device_id",
                finished=True,
            )
            processed += 1
            continue

        try:
            response = run_auto_backups(
                schemas.AutoBackupRequest(
                    created_by=pending_job.requested_by,
                    device_ids=[pending_job.device_id],
                ),
                db,
            )
        except HTTPException as exc:
            update_job(
                db,
                pending_job,
                retry_count=pending_job.retry_count + 1,
                message=f"Pending retry skipped: {exc.detail}",
            )
            processed += 1
            continue
        except Exception as exc:
            update_job(
                db,
                pending_job,
                retry_count=pending_job.retry_count + 1,
                message=f"Pending retry failed: {exc}",
            )
            processed += 1
            continue

        if response.online_devices > 0:
            update_job(
                db,
                pending_job,
                status=constants.JOB_STATUS_SUCCESS,
                checked_devices=1,
                online_devices=1,
                offline_devices=0,
                backups_created=response.backups_created,
                retry_count=pending_job.retry_count + 1,
                message="Pending device is online, auto backup checked",
                finished=True,
            )
        else:
            update_job(
                db,
                pending_job,
                checked_devices=pending_job.checked_devices + 1,
                offline_devices=1,
                retry_count=pending_job.retry_count + 1,
                message="Device still offline, waiting for next pending retry",
            )
        processed += 1

    return processed


def _run_auto_backups(
    data: schemas.AutoBackupRequest,
    db: Session,
    job: models.BackupJob,
    max_retries: int,
    retry_delay_seconds: float,
) -> schemas.AutoBackupResponse:
    username, password, port = require_ssh_credentials()

    remote_paths = data.remote_paths or _default_auto_backup_paths()
    if not remote_paths:
        raise api_exception(
            status.HTTP_400_BAD_REQUEST,
            "AUTO_BACKUP_PATHS_MISSING",
            "No remote paths configured for auto backup",
        )

    devices_query = (
        db.query(models.Device)
        .filter(models.Device.auto_backup_enabled.is_(True))
        .order_by(models.Device.device_id)
    )
    if data.device_ids:
        devices_query = devices_query.filter(models.Device.device_id.in_(data.device_ids))
    devices = devices_query.all()

    items = []
    skipped_offline = 0
    backups_created = 0
    online_devices = 0
    failed_devices = 0
    retry_count = 0
    checked_devices = 0
    skipped_device_names = []

    update_job(
        db,
        job,
        total_devices=len(devices),
        message=f"Auto backup started for {len(devices)} device(s)",
    )

    for device in devices:
        device_result = None
        max_attempts = max(max_retries, 1)
        for attempt in range(max_attempts):
            try:
                device_result = _run_auto_backup_for_device(
                    db=db,
                    device=device,
                    remote_paths=remote_paths,
                    username=username,
                    password=password,
                    port=port,
                    data=data,
                )
                break
            except Exception as exc:
                if attempt < max_attempts - 1:
                    retry_count += 1
                    update_job(
                        db,
                        job,
                        retry_count=retry_count,
                        message=(
                            f"Retrying {device.device_name} "
                            f"({attempt + 1}/{max_attempts}): {exc}"
                        ),
                    )
                    if retry_delay_seconds > 0:
                        time.sleep(retry_delay_seconds)
                    continue

                _mark_device_status(db, device, online=False)
                _ensure_light_pending_retry(db, device, data.created_by, exc)
                skipped_device_names.append(_device_label(device))
                device_result = {
                    "items": [
                        schemas.AutoBackupItemResponse(
                            device_id=device.device_id,
                            ip_address=device.ip_address,
                            device_name=device.device_name,
                            remote_path=", ".join(remote_paths),
                            online=False,
                            changed=False,
                            message=(
                                "Skipped after retries; device marked offline and pending retry will check "
                                f"again later: {exc}"
                            ),
                        )
                    ],
                    "online": False,
                    "backup_created": False,
                    "offline": True,
                }

        items.extend(device_result["items"])
        if device_result["online"]:
            online_devices += 1
        if device_result["offline"]:
            skipped_offline += 1
        if device_result["backup_created"]:
            backups_created += 1
        checked_devices += 1

        update_job(
            db,
            job,
            checked_devices=checked_devices,
            online_devices=online_devices,
            offline_devices=skipped_offline,
            backups_created=backups_created,
            failed_devices=failed_devices,
            retry_count=retry_count,
            message=_auto_backup_progress_message(
                checked_devices=checked_devices,
                total_devices=len(devices),
                skipped_device_names=skipped_device_names,
            ),
        )

    return schemas.AutoBackupResponse(
        job_id=job.job_id,
        checked_devices=len(devices),
        skipped_offline=skipped_offline,
        online_devices=online_devices,
        backups_created=backups_created,
        failed_devices=failed_devices,
        items=items,
    )


def _auto_backup_finished_status(response: schemas.AutoBackupResponse) -> int:
    if response.failed_devices > 0:
        return constants.JOB_STATUS_FAILED
    if response.checked_devices > 0 and response.online_devices == 0:
        return constants.JOB_STATUS_SKIPPED
    return constants.JOB_STATUS_SUCCESS


def _auto_backup_completion_message(response: schemas.AutoBackupResponse) -> str:
    message = (
        f"Auto backup completed: checked={response.checked_devices}, "
        f"online={response.online_devices}, offline={response.skipped_offline}, "
        f"created={response.backups_created}, failed={response.failed_devices}"
    )
    skipped_names = [
        f"{item.device_name} ({item.ip_address})"
        for item in response.items
        if not item.online
    ]
    if skipped_names:
        message = f"{message}; skipped={_compact_device_names(skipped_names)}"
    return message


def _auto_backup_progress_message(
    checked_devices: int,
    total_devices: int,
    skipped_device_names: List[str],
) -> str:
    message = f"Auto backup progress: checked={checked_devices}/{total_devices}"
    if skipped_device_names:
        message = f"{message}; skipped={_compact_device_names(skipped_device_names)}"
    return message


def _compact_device_names(device_names: List[str], limit: int = 6) -> str:
    visible_names = device_names[:limit]
    hidden_count = max(len(device_names) - limit, 0)
    message = ", ".join(visible_names)
    if hidden_count:
        message = f"{message}, +{hidden_count} more"
    return message


def _device_label(device: models.Device) -> str:
    if device.ip_address:
        return f"{device.device_name} ({device.ip_address})"
    return device.device_name


def _run_auto_backup_for_device(
    db: Session,
    device: models.Device,
    remote_paths: List[str],
    username: str,
    password: str,
    port: int,
    data: schemas.AutoBackupRequest,
) -> dict:
    latest_backup = _latest_auto_backup_for_device(db, device.device_id)
    path_checks = []
    missing_path_items = []

    for remote_path in remote_paths:
        try:
            snapshot = snapshot_remote_path(
                host=device.ip_address,
                username=username,
                password=password,
                port=port,
                remote_path=remote_path,
            )
        except RemotePathNotFound as exc:
            missing_path_items.append(
                schemas.AutoBackupItemResponse(
                    device_id=device.device_id,
                    ip_address=device.ip_address,
                    device_name=device.device_name,
                    remote_path=remote_path,
                    online=True,
                    changed=False,
                    message=f"Remote path not found, skipped: {exc.remote_path}",
                )
            )
            continue
        except Exception as exc:
            raise RuntimeError(f"SFTP check failed for {remote_path}: {exc}") from exc

        changed = _remote_snapshot_changed(snapshot, latest_backup, remote_path)
        path_checks.append((remote_path, snapshot, changed))

    device_items = missing_path_items
    database_dump = None
    with tempfile.TemporaryDirectory(prefix="robot-db-check-") as temp_dir:
        database_path = _configured_robot_database_path(Path(temp_dir))
        if database_path:
            try:
                database_dump = _dump_robot_database(device, database_path)
            except Exception as exc:
                device_items.append(
                    schemas.AutoBackupItemResponse(
                        device_id=device.device_id,
                        ip_address=device.ip_address,
                        device_name=device.device_name,
                        remote_path=_robot_database_label(),
                        online=True,
                        changed=False,
                        message=f"Database check failed: {exc}",
                    )
                )
                database_dump = None

        database_changed = (
            _database_dump_changed(database_dump, latest_backup)
            if database_dump
            else False
        )
        changed_remote_paths = [
            remote_path
            for remote_path, _, changed in path_checks
            if changed
        ]
        has_changes = any(changed for _, _, changed in path_checks) or database_changed

        backup_created = False
        if has_changes:
            backup = _create_combined_auto_backup(
                db=db,
                device=device,
                created_by=data.created_by,
                remote_paths=changed_remote_paths,
                database_dump=database_dump if database_changed else None,
                zip_output=data.zip_output,
            )
            backup_created = True
            backup_id = backup.backup_id
        else:
            backup_id = latest_backup.backup_id if latest_backup else None

        for remote_path, snapshot, changed in path_checks:
            device_items.append(
                schemas.AutoBackupItemResponse(
                    device_id=device.device_id,
                    ip_address=device.ip_address,
                    device_name=device.device_name,
                    remote_path=remote_path,
                    online=True,
                    changed=changed,
                    backup_id=backup_id,
                    remote_modified_at=snapshot.modified_at,
                    remote_checksum=snapshot.checksum,
                    message=(
                        "File changed, combined auto backup created"
                        if changed and has_changes
                        else "No change detected"
                    ),
                )
            )

        if database_dump:
            device_items.append(
                schemas.AutoBackupItemResponse(
                    device_id=device.device_id,
                    ip_address=device.ip_address,
                    device_name=device.device_name,
                    remote_path=database_dump.remote_path,
                    online=True,
                    changed=database_changed,
                    backup_id=backup_id,
                    remote_checksum=database_dump.checksum,
                    message=(
                        "Database changed, combined auto backup created"
                        if database_changed and has_changes
                        else "Database has no change"
                    ),
                )
            )

    _mark_device_status(db, device, online=True)
    return {
        "items": device_items,
        "online": True,
        "offline": False,
        "backup_created": backup_created,
    }


def _ensure_light_pending_retry(
    db: Session,
    device: models.Device,
    requested_by: Optional[int],
    exc: Exception,
) -> None:
    if os.getenv("AUTO_BACKUP_PENDING_ENABLED", "true").lower() != "true":
        return

    ensure_pending_auto_backup_job(
        db=db,
        device_id=device.device_id,
        requested_by=requested_by,
        message=(
            "Device offline after auto backup retries; "
            f"waiting for lightweight pending retry: {exc}"
        ),
    )


def backup_history_response(backup: models.Backup) -> schemas.BackupHistoryResponse:
    return schemas.BackupHistoryResponse(
        backup_id=backup.backup_id,
        device_id=backup.device_id,
        device_name=backup.device.device_name if backup.device else None,
        ip_address=backup.device.ip_address if backup.device else None,
        backup_name=backup.backup_name,
        backup_type=backup.backup_type,
        backup_status=backup.backup_status,
        total_file=backup.total_file,
        total_size_mb=backup.total_size_mb,
        created_by=backup.created_by,
        created_at=backup.created_at,
        updated_at=backup.updated_at,
    )


def _create_combined_auto_backup(
    db: Session,
    device: models.Device,
    created_by: Optional[int],
    remote_paths: List[str],
    database_dump: Optional[DownloadedFile],
    zip_output: bool,
    backup_name: Optional[str] = None,
    backup_type: int = constants.BACKUP_TYPE_AUTO,
) -> models.Backup:
    user = resolve_user(db, created_by)
    backup_storage_path = os.getenv("BACKUP_STORAGE_PATH", "storage/backups")

    username = password = port = None
    if remote_paths:
        username, password, port = require_ssh_credentials()

    backup_name = backup_name or _auto_full_backup_name(device.device_name)
    local_path = build_backup_directory(backup_storage_path, device.device_name)
    backup = _create_backup_record(db, device, user, backup_name, backup_type)

    try:
        downloaded_files = []
        if remote_paths:
            downloaded_files = download_paths(
                host=device.ip_address,
                username=username,
                password=password,
                port=port,
                remote_paths=remote_paths,
                local_root=local_path,
            )

        if database_dump:
            database_local_path = local_path / database_dump.file_name
            database_local_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(database_dump.local_path, database_local_path)
            downloaded_files.append(
                DownloadedFile(
                    file_name=database_dump.file_name,
                    local_path=str(database_local_path),
                    remote_path=database_dump.remote_path,
                    file_size_mb=database_local_path.stat().st_size / (1024 * 1024),
                    checksum=database_dump.checksum,
                )
            )

        zip_path = None
        if zip_output:
            zip_file = create_zip_archive(local_path, backup_name)
            downloaded_files = [zip_file]
            zip_path = zip_file.local_path

        total_size_mb = _total_size_mb(downloaded_files)
        message = "Combined auto backup completed"
        if zip_path:
            message = f"{message}: {zip_path}"
        _finish_backup_success(db, backup, downloaded_files, total_size_mb, message)
    except RuntimeError as exc:
        _finish_backup_failed(db, backup, str(exc))
        raise api_exception(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "COMBINED_BACKUP_FAILED",
            str(exc),
        )
    except Exception as exc:
        message = f"Combined auto backup failed: {exc}"
        _finish_backup_failed(db, backup, message)
        raise api_exception(
            status.HTTP_502_BAD_GATEWAY,
            "COMBINED_BACKUP_FAILED",
            message,
        )

    return backup


def _dump_robot_database(
    device: models.Device,
    output_path: Path,
    database_name: Optional[str] = None,
    table_name: Optional[str] = None,
) -> DownloadedFile:
    database_name = database_name or os.getenv("ROBOT_DB_NAME")
    table_name = table_name or os.getenv("ROBOT_DB_TABLE")
    username = os.getenv("ROBOT_DB_USER")
    password = os.getenv("ROBOT_DB_PASSWORD")
    port = int(os.getenv("ROBOT_DB_PORT", "3306"))
    ssh_username = os.getenv("ROBOT_SSH_USERNAME")
    ssh_password = os.getenv("ROBOT_SSH_PASSWORD")
    ssh_port = int(os.getenv("ROBOT_SSH_PORT", "22"))

    if not database_name or not table_name or not username or not password:
        raise RuntimeError("Robot database config is incomplete")

    try:
        return dump_mysql_table_to_json(
            host=device.ip_address,
            port=port,
            username=username,
            password=password,
            database=database_name,
            table=table_name,
            output_path=output_path,
        )
    except Exception as direct_exc:
        if not ssh_username or not ssh_password:
            raise direct_exc

        return dump_mysql_table_via_ssh(
            host=device.ip_address,
            ssh_username=ssh_username,
            ssh_password=ssh_password,
            ssh_port=ssh_port,
            db_username=username,
            db_password=password,
            db_port=port,
            database=database_name,
            table=table_name,
            output_path=output_path,
        )


def _configured_robot_database_path(root: Path) -> Optional[Path]:
    database_name = os.getenv("ROBOT_DB_NAME")
    table_name = os.getenv("ROBOT_DB_TABLE")
    username = os.getenv("ROBOT_DB_USER")
    password = os.getenv("ROBOT_DB_PASSWORD")
    if not database_name or not table_name or not username or not password:
        return None
    return root / f"{database_name}_{table_name}.json"


def _latest_auto_backup_for_device(
    db: Session,
    device_id: int,
) -> Optional[models.Backup]:
    return (
        db.query(models.Backup)
        .filter(
            models.Backup.device_id == device_id,
            models.Backup.backup_type == constants.BACKUP_TYPE_AUTO,
            models.Backup.backup_status == constants.BACKUP_STATUS_SUCCESS,
        )
        .order_by(models.Backup.created_at.desc(), models.Backup.backup_id.desc())
        .first()
    )


def _remote_snapshot_changed(
    snapshot: RemotePathSnapshot,
    latest_backup: Optional[models.Backup],
    remote_path: str,
) -> bool:
    if not latest_backup:
        return True

    latest_checksum = _latest_backup_checksum_for_remote_path(latest_backup, remote_path)
    if not latest_checksum:
        return True

    if snapshot.modified_at <= latest_backup.created_at:
        return False

    return snapshot.checksum != latest_checksum


def _latest_backup_checksum_for_remote_path(
    latest_backup: models.Backup,
    remote_path: str,
) -> Optional[str]:
    remote_name = Path(remote_path.rstrip("/")).name
    if not remote_name:
        return None

    matching_files = []
    for backup_file in latest_backup.files:
        file_path = Path(backup_file.file_path)
        if not file_path.exists():
            continue
        if file_path.name == remote_name or remote_name in file_path.parts:
            matching_files.append(backup_file)

    if not matching_files:
        return None
    if len(matching_files) == 1:
        return matching_files[0].checksum

    return _local_files_signature(matching_files)


def _database_dump_changed(
    database_dump: DownloadedFile,
    latest_backup: Optional[models.Backup],
) -> bool:
    if not latest_backup:
        return True

    for backup_file in latest_backup.files:
        file_path = Path(backup_file.file_path)
        if (
            file_path.exists()
            and backup_file.file_name == database_dump.file_name
            and backup_file.checksum
        ):
            return backup_file.checksum != database_dump.checksum

    database_stem = Path(database_dump.file_name).stem
    for backup_file in latest_backup.files:
        if Path(backup_file.file_name).stem == database_stem and backup_file.checksum:
            return backup_file.checksum != database_dump.checksum

    return True


def _mark_device_status(db: Session, device: models.Device, online: bool) -> None:
    device.device_status = (
        constants.DEVICE_STATUS_ONLINE
        if online
        else constants.DEVICE_STATUS_OFFLINE
    )
    if online:
        device.last_seen_at = now_local()
    device.updated_at = now_local()
    db.commit()


def _auto_full_backup_name(device_name: str) -> str:
    safe_device_name = re.sub(r"[^A-Za-z0-9]+", "_", device_name).strip("_")
    return f"auto_full_{safe_device_name}_{now_local():%Y%m%d_%H%M%S}"


def _robot_database_label() -> str:
    database_name = os.getenv("ROBOT_DB_NAME", "database")
    table_name = os.getenv("ROBOT_DB_TABLE", "table")
    return f"mysql://{database_name}/{table_name}"


def get_backup_or_404(backup_id: int, db: Session) -> models.Backup:
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


def _create_backup_record(
    db: Session,
    device: models.Device,
    user: models.User,
    backup_name: str,
    backup_type: int,
) -> models.Backup:
    now = now_local()
    backup = models.Backup(
        device_id=device.device_id,
        backup_name=backup_name,
        backup_type=backup_type,
        backup_status=constants.BACKUP_STATUS_RUNNING,
        total_file=0,
        total_size_mb=Decimal("0.00"),
        created_by=user.user_id,
        created_at=now,
        updated_at=now,
    )
    db.add(backup)
    db.commit()
    db.refresh(backup)
    log_activity(db, user.user_id, device.device_id, backup.backup_id, "backup", constants.BACKUP_STATUS_RUNNING, "Backup started")
    db.commit()
    return backup


def _finish_backup_success(
    db: Session,
    backup: models.Backup,
    files: List[DownloadedFile],
    total_size_mb: Decimal,
    message: str,
) -> None:
    now = now_local()
    backup.backup_status = constants.BACKUP_STATUS_SUCCESS
    backup.total_file = len(files)
    backup.total_size_mb = total_size_mb
    backup.updated_at = now

    for file in files:
        db.add(
            models.BackupFile(
                backup_id=backup.backup_id,
                file_name=file.file_name,
                file_path=file.local_path,
                file_type=_file_type(file.local_path),
                file_size_mb=Decimal(str(round(file.file_size_mb, 2))),
                checksum=file.checksum,
                file_status=constants.BACKUP_STATUS_SUCCESS,
                created_at=now,
            )
        )

    log_activity(db, backup.created_by, backup.device_id, backup.backup_id, "backup", constants.BACKUP_STATUS_SUCCESS, message)
    db.commit()
    db.refresh(backup)


def _finish_backup_failed(db: Session, backup: models.Backup, message: str) -> None:
    backup.backup_status = constants.BACKUP_STATUS_FAILED
    backup.updated_at = now_local()
    log_activity(db, backup.created_by, backup.device_id, backup.backup_id, "backup", constants.BACKUP_STATUS_FAILED, message)
    db.commit()


def _succeed_job(
    db: Session,
    job: models.BackupJob,
    backup: models.Backup,
    message: str,
) -> None:
    update_job(
        db,
        job,
        status=constants.JOB_STATUS_SUCCESS,
        backup_id=backup.backup_id,
        total_devices=1,
        checked_devices=1,
        online_devices=1,
        backups_created=1,
        message=message,
        finished=True,
    )


def _fail_backup_job(
    db: Session,
    job: models.BackupJob,
    backup: models.Backup,
    message: str,
    error_code: str,
    http_status: int,
) -> None:
    _finish_backup_failed(db, backup, message)
    update_job(
        db,
        job,
        status=constants.JOB_STATUS_FAILED,
        backup_id=backup.backup_id,
        total_devices=1,
        checked_devices=1,
        failed_devices=1,
        message=message,
        finished=True,
    )
    raise api_exception(http_status, error_code, message)


def _existing_zip_file(backup_files: List[models.BackupFile]) -> Optional[Path]:
    for backup_file in backup_files:
        file_path = Path(backup_file.file_path)
        if file_path.suffix.lower() == ".zip" and file_path.exists():
            return file_path
    return None


def _make_download_zip(backup: models.Backup, backup_files: List[models.BackupFile], selected: bool = False) -> Path:
    base_path = Path(os.getenv("BACKUP_STORAGE_PATH", "storage/backups")) / "downloads"
    base_path.mkdir(parents=True, exist_ok=True)
    if selected:
        selected_ids = ",".join(str(file.backup_file_id) for file in backup_files)
        selection_hash = hashlib.sha256(selected_ids.encode("ascii")).hexdigest()[:16]
        zip_path = base_path / f"backup_{backup.backup_id}_selected_{len(backup_files)}_{selection_hash}.zip"
    else:
        zip_path = base_path / f"backup_{backup.backup_id}.zip"

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        used_names = set()
        for backup_file in backup_files:
            file_path = Path(backup_file.file_path)
            if not file_path.exists():
                raise api_exception(
                    status.HTTP_404_NOT_FOUND,
                    "BACKUP_FILE_MISSING_ON_SERVER",
                    "Backup file missing on server",
                    {"file_path": str(file_path)},
                )
            archive.write(file_path, arcname=_unique_archive_name(backup_file.file_name, used_names))

    return zip_path


def _unique_archive_name(file_name: str, used_names: set) -> str:
    archive_name = file_name
    stem = Path(file_name).stem
    suffix = Path(file_name).suffix
    index = 2

    while archive_name in used_names:
        archive_name = f"{stem} ({index}){suffix}"
        index += 1

    used_names.add(archive_name)
    return archive_name


def _total_size_mb(files: List[DownloadedFile]) -> Decimal:
    return Decimal(str(round(sum(file.file_size_mb for file in files), 2)))


def _file_type(file_path: str) -> str:
    return Path(file_path).suffix.lstrip(".") or "file"


def _is_latest_backup_for_device(backup: models.Backup, db: Session) -> bool:
    latest_backup_id = (
        db.query(models.Backup.backup_id)
        .filter(models.Backup.device_id == backup.device_id)
        .order_by(models.Backup.created_at.desc(), models.Backup.backup_id.desc())
        .limit(1)
        .scalar()
    )
    return latest_backup_id == backup.backup_id


def _backup_cleanup_skip_reason(
    backup: models.Backup,
    db: Session,
    keep_latest_per_device: bool,
) -> Optional[str]:
    if keep_latest_per_device and _is_latest_backup_for_device(backup, db):
        return "Latest backup for this device"

    return None


def _delete_restore_history_for_backup(
    backup: models.Backup,
    backup_files: List[models.BackupFile],
    db: Session,
) -> None:
    restore_logs = (
        db.query(models.RestoreLog)
        .filter(models.RestoreLog.backup_id == backup.backup_id)
        .all()
    )
    restore_ids = [restore_log.restore_id for restore_log in restore_logs]
    backup_file_ids = [backup_file.backup_file_id for backup_file in backup_files]

    if restore_ids:
        (
            db.query(models.RestoreItem)
            .filter(models.RestoreItem.restore_id.in_(restore_ids))
            .delete(synchronize_session=False)
        )

    if backup_file_ids:
        (
            db.query(models.RestoreItem)
            .filter(models.RestoreItem.backup_file_id.in_(backup_file_ids))
            .delete(synchronize_session=False)
        )

    for restore_log in restore_logs:
        db.delete(restore_log)


def _cleanup_item(
    backup: models.Backup,
    deleted: bool,
    reason: str,
) -> schemas.BackupCleanupItemResponse:
    return schemas.BackupCleanupItemResponse(
        backup_id=backup.backup_id,
        device_id=backup.device_id,
        backup_name=backup.backup_name,
        created_at=backup.created_at,
        deleted=deleted,
        reason=reason,
    )


def _delete_backup_files_from_disk(backup_files: List[models.BackupFile]) -> int:
    deleted_count = 0
    backup_storage_root = Path(os.getenv("BACKUP_STORAGE_PATH", "storage/backups")).resolve()
    touched_dirs = set()

    for backup_file in backup_files:
        file_path = Path(backup_file.file_path)
        if not file_path.exists() or not file_path.is_file():
            continue

        resolved_path = file_path.resolve()
        try:
            resolved_path.relative_to(backup_storage_root)
        except ValueError:
            continue

        touched_dirs.add(resolved_path.parent)
        resolved_path.unlink()
        deleted_count += 1

    for directory in sorted(touched_dirs, key=lambda value: len(value.parts), reverse=True):
        _remove_empty_backup_dirs(directory, backup_storage_root)

    return deleted_count


def _remove_empty_backup_dirs(directory: Path, backup_storage_root: Path) -> None:
    current = directory
    while current != backup_storage_root and backup_storage_root in current.parents:
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


def _default_auto_backup_paths() -> List[str]:
    return get_default_auto_backup_paths()


def _local_files_signature(backup_files: List[models.BackupFile]) -> str:
    file_paths = [Path(file.file_path) for file in backup_files]
    common_root = Path(os.path.commonpath([str(path.parent) for path in file_paths]))
    digest = hashlib.sha256()

    for backup_file in sorted(backup_files, key=lambda value: value.file_path):
        file_path = Path(backup_file.file_path)
        relative_path = file_path.relative_to(common_root).as_posix()
        size_bytes = file_path.stat().st_size
        digest.update(relative_path.encode("utf-8"))
        digest.update(str(size_bytes).encode("ascii"))
        digest.update((backup_file.checksum or "").encode("ascii"))

    return digest.hexdigest()
