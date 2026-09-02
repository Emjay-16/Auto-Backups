import hashlib
import json
import os
import posixpath
import re
import shutil
import tempfile
import threading
import time
import zipfile
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from api import constants, models, schemas
from api.errors import api_exception
from api.path_utils import project_path
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
from api.services.robot_database import (
    _database_payload_checksum,
    dump_mysql_table_to_json,
    dump_mysql_table_via_ssh,
)
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
_AUTO_BACKUP_MANIFEST_NAME = ".auto_backup_manifest.json"
_MAX_AUTO_BACKUPS_PER_MONTH = 4


def get_backup_history(db: Session, limit: int) -> List[schemas.BackupHistoryResponse]:
    limit = max(1, min(limit, 200))
    backups = (
        db.query(models.Backup)
        .order_by(models.Backup.created_at.desc(), models.Backup.backup_id.desc())
        .limit(limit)
        .all()
    )
    return [backup_history_response(backup) for backup in backups]


def recover_stale_running_records(db: Session, max_age_hours: float = 24) -> Tuple[int, int]:
    cutoff = now_local() - timedelta(hours=max(float(max_age_hours), 1))
    stale_backups = (
        db.query(models.Backup)
        .filter(
            models.Backup.backup_status == constants.BACKUP_STATUS_RUNNING,
            models.Backup.updated_at < cutoff,
        )
        .all()
    )
    for backup in stale_backups:
        _finish_backup_failed(
            db,
            backup,
            f"Backup marked failed after exceeding {max_age_hours:g} hour(s); worker stopped or timed out",
        )

    stale_jobs = (
        db.query(models.BackupJob)
        .filter(
            models.BackupJob.job_status == constants.JOB_STATUS_RUNNING,
            models.BackupJob.updated_at < cutoff,
        )
        .all()
    )
    for job in stale_jobs:
        update_job(
            db,
            job,
            status=constants.JOB_STATUS_FAILED,
            message=f"Job marked failed after exceeding {max_age_hours:g} hour(s); worker stopped or timed out",
            finished=True,
        )

    stale_locks = db.query(models.JobLock).all()
    for lock in stale_locks:
        if not is_job_lock_active(db, lock.lock_name):
            db.delete(lock)

    db.commit()

    return len(stale_backups), len(stale_jobs)


def get_backup_detail(backup_id: int, db: Session) -> dict:
    backup = get_backup_or_404(backup_id, db)
    response = backup_history_response(backup).model_dump()
    response["files"] = _backup_detail_files(backup)
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
    age_candidates = (
        db.query(models.Backup)
        .filter(models.Backup.created_at < cutoff)
        .order_by(models.Backup.created_at, models.Backup.backup_id)
        .all()
    )
    monthly_candidates = _monthly_backup_excess(db, max_per_month=_MAX_AUTO_BACKUPS_PER_MONTH)
    monthly_candidate_ids = {backup.backup_id for backup in monthly_candidates}
    backups = list({backup.backup_id: backup for backup in age_candidates + monthly_candidates}.values())
    backups.sort(key=lambda backup: (backup.created_at, backup.backup_id))

    items = []
    deleted = 0
    skipped = 0

    for backup in backups:
        monthly_excess = backup.backup_id in monthly_candidate_ids
        reason = _backup_cleanup_skip_reason(
            backup,
            db,
            keep_latest_per_device=data.keep_latest_per_device,
            monthly_excess=monthly_excess,
        )
        if reason:
            skipped += 1
            items.append(_cleanup_item(backup, deleted=False, reason=reason))
            continue

        item = _cleanup_item(
            backup,
            deleted=True,
            reason="Deleted: more than 4 auto backups in this month" if monthly_excess else "Deleted",
        )
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


def _monthly_backup_excess(db: Session, max_per_month: int) -> List[models.Backup]:
    auto_backups = (
        db.query(models.Backup)
        .filter(
            models.Backup.backup_type == constants.BACKUP_TYPE_AUTO,
            models.Backup.backup_status != constants.BACKUP_STATUS_RUNNING,
        )
        .order_by(models.Backup.device_id.asc(), models.Backup.created_at.desc(), models.Backup.backup_id.desc())
        .all()
    )

    grouped: Dict[Tuple[int, int, int], List[models.Backup]] = {}
    for backup in auto_backups:
        key = (backup.device_id, backup.created_at.year, backup.created_at.month)
        grouped.setdefault(key, []).append(backup)

    excess: List[models.Backup] = []
    for backups in grouped.values():
        if len(backups) <= max(max_per_month, 1):
            continue
        excess.extend(backups[max(max_per_month, 1):])
    return excess


def cleanup_age_delta(data: schemas.BackupCleanupRequest) -> timedelta:
    if data.older_than_hours is not None and data.older_than_hours > 0:
        return timedelta(hours=data.older_than_hours)
    return timedelta(days=max(data.older_than_days, 1))


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
            local_path=str(project_path(os.getenv("BACKUP_STORAGE_PATH", "storage/backups")) / device.device_name),
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

    max_pending_retries = _pending_max_retries()
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
            _update_pending_retry_job(
                db=db,
                pending_job=pending_job,
                retry_count=pending_job.retry_count + 1,
                max_pending_retries=max_pending_retries,
                waiting_message=f"Pending retry skipped: {exc.detail}",
                skipped_message=f"Pending retry skipped after {max_pending_retries} check(s): {exc.detail}",
            )
            processed += 1
            continue
        except Exception as exc:
            _update_pending_retry_job(
                db=db,
                pending_job=pending_job,
                retry_count=pending_job.retry_count + 1,
                max_pending_retries=max_pending_retries,
                waiting_message=f"Pending retry failed: {exc}",
                skipped_message=f"Pending retry failed after {max_pending_retries} check(s): {exc}",
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
            _update_pending_retry_job(
                db=db,
                pending_job=pending_job,
                retry_count=pending_job.retry_count + 1,
                max_pending_retries=max_pending_retries,
                checked_devices=pending_job.checked_devices + 1,
                waiting_message="Device still offline, waiting for next pending retry",
                skipped_message=f"Device still offline after {max_pending_retries} pending check(s), skipped",
            )
        processed += 1

    return processed


def _pending_max_retries() -> int:
    raw_value = os.getenv("AUTO_BACKUP_PENDING_MAX_RETRIES", "3")
    try:
        return max(int(raw_value), 1)
    except ValueError:
        return 3


def _update_pending_retry_job(
    *,
    db: Session,
    pending_job: models.BackupJob,
    retry_count: int,
    max_pending_retries: int,
    waiting_message: str,
    skipped_message: str,
    checked_devices: Optional[int] = None,
) -> None:
    if retry_count >= max_pending_retries:
        if pending_job.device:
            _mark_device_status(db, pending_job.device, online=False)
        update_job(
            db,
            pending_job,
            status=constants.JOB_STATUS_SKIPPED,
            checked_devices=checked_devices,
            offline_devices=1,
            retry_count=retry_count,
            message=skipped_message,
            finished=True,
        )
        return

    update_job(
        db,
        pending_job,
        checked_devices=checked_devices,
        offline_devices=1,
        retry_count=retry_count,
        message=waiting_message,
    )


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
                update_job(
                    db,
                    job,
                    checked_devices=checked_devices,
                    online_devices=online_devices,
                    offline_devices=skipped_offline,
                    backups_created=backups_created,
                    failed_devices=failed_devices,
                    retry_count=retry_count,
                    message=f"Checking {_device_label(device)} ({checked_devices + 1}/{len(devices)})",
                )
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
    recent_backups = _recent_auto_backups_for_device(db, device.device_id)
    latest_backup = recent_backups[0] if recent_backups else None
    force_full_backup = _should_create_full_baseline(
        recent_backups=recent_backups,
        device=device,
        remote_paths=remote_paths,
        interval_days=data.full_baseline_interval_days,
        forced=data.force_full_backup,
    )
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

        changed = True if force_full_backup else _remote_snapshot_changed(snapshot, recent_backups, remote_path)
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
            True if force_full_backup else _database_dump_changed(database_dump, recent_backups)
        ) if database_dump else False
        manifest = _build_auto_backup_manifest(
            path_checks,
            database_dump,
            backup_mode="full_baseline" if force_full_backup else "incremental",
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
                manifest=manifest,
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
                        "Full baseline backup created"
                        if changed and has_changes and force_full_backup
                        else "File changed, incremental backup created"
                        if changed and has_changes
                        else "No change detected"
                    ),
                )
            )

        if database_dump:
            # database_dump is List[DownloadedFile]; report one item per split file
            for dump_file in database_dump:
                device_items.append(
                    schemas.AutoBackupItemResponse(
                        device_id=device.device_id,
                        ip_address=device.ip_address,
                        device_name=device.device_name,
                        remote_path=dump_file.remote_path,
                        online=True,
                        changed=database_changed,
                        backup_id=backup_id,
                        remote_checksum=dump_file.checksum,
                        message=(
                            "Database included in full baseline backup"
                            if database_changed and has_changes and force_full_backup
                            else "Database changed, incremental backup created"
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


def _backup_detail_files(backup: models.Backup) -> List[dict]:
    manifest = _read_auto_backup_manifest(backup)
    return [
        _backup_file_detail(backup_file, manifest)
        for backup_file in backup.files
    ]


def _backup_file_detail(
    backup_file: models.BackupFile,
    manifest: Optional[Dict[str, Any]],
) -> dict:
    detail = schemas.BackupFileResponse.model_validate(backup_file).model_dump()
    detail["remote_path"] = _backup_file_remote_path(backup_file, manifest)
    return detail


def _backup_file_remote_path(
    backup_file: models.BackupFile,
    manifest: Optional[Dict[str, Any]],
) -> Optional[str]:
    configured_database_file = _configured_robot_database_path(Path("/tmp"))
    if configured_database_file:
        db_stem = configured_database_file.stem
        file_path = Path(backup_file.file_name)
        file_stem = file_path.stem
        parent_name = file_path.parent.name
        # Match exact database file OR any file inside {stem}.ros_maps/ folder
        if (
            backup_file.file_name == configured_database_file.name
            or file_stem.startswith(f"{db_stem}_")
            or parent_name == f"{db_stem}.ros_maps"
        ):
            return f"database://{backup_file.file_name}"

    if not manifest:
        return None

    paths = manifest.get("paths")
    if not isinstance(paths, dict):
        return None

    remote_items = [
        item
        for item in paths.values()
        if isinstance(item, dict) and isinstance(item.get("remote_path"), str)
    ]
    if not remote_items:
        return None

    file_path = Path(backup_file.file_path)
    if file_path.suffix.lower() == ".zip":
        return _single_manifest_remote_path(remote_items)

    backup_root = next(
        (parent for parent in file_path.parents if (parent / ".auto_backup_manifest.json").exists()),
        None,
    )
    if backup_root:
        relative_file_path = file_path.relative_to(backup_root).as_posix()
        normalized_relative_path = relative_file_path.lstrip("/").lower()
        database_items = [
            item for item in remote_items
            if item["remote_path"].lower().startswith(("ssh+mysql://", "mysql://"))
        ]
        if len(database_items) == 1 and "/" not in relative_file_path:
            return database_items[0]["remote_path"]
        for item in remote_items:
            remote_path = item["remote_path"].replace("\\", "/")
            normalized_remote_path = remote_path.rstrip("/").lstrip("/").lower()
            if normalized_relative_path == normalized_remote_path or normalized_relative_path.startswith(f"{normalized_remote_path}/"):
                suffix = relative_file_path[len(normalized_remote_path):].lstrip("/")
                return posixpath.join(remote_path.rstrip("/"), suffix) if suffix else remote_path

    file_name = backup_file.file_name
    for item in remote_items:
        remote_path = item["remote_path"]
        if posixpath.basename(remote_path.rstrip("/")) == file_name:
            return remote_path

    return None


def _single_manifest_remote_path(remote_items: List[Dict[str, Any]]) -> Optional[str]:
    remote_paths = {
        item["remote_path"]
        for item in remote_items
        if isinstance(item.get("remote_path"), str)
    }
    if len(remote_paths) == 1:
        return next(iter(remote_paths))
    return None


def _create_combined_auto_backup(
    db: Session,
    device: models.Device,
    created_by: Optional[int],
    remote_paths: List[str],
    database_dump: Optional[List[DownloadedFile]],
    zip_output: bool,
    backup_name: Optional[str] = None,
    backup_type: int = constants.BACKUP_TYPE_AUTO,
    manifest: Optional[Dict[str, Any]] = None,
) -> models.Backup:
    user = resolve_user(db, created_by)
    backup_storage_path = str(project_path(os.getenv("BACKUP_STORAGE_PATH", "storage/backups")))

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
            for dump_file in database_dump:
                database_local_path = local_path / dump_file.file_name
                database_local_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dump_file.local_path, database_local_path)
                downloaded_files.append(
                    DownloadedFile(
                        file_name=dump_file.file_name,
                        local_path=str(database_local_path),
                        remote_path=dump_file.remote_path,
                        file_size_mb=database_local_path.stat().st_size / (1024 * 1024),
                        checksum=dump_file.checksum,
                    )
                )

        if manifest:
            _write_auto_backup_manifest(local_path, manifest)

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
) -> List[DownloadedFile]:
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


def _configured_robot_database_remote_path(device: models.Device) -> Optional[str]:
    database_name = os.getenv("ROBOT_DB_NAME")
    table_name = os.getenv("ROBOT_DB_TABLE")
    username = os.getenv("ROBOT_DB_USER")
    password = os.getenv("ROBOT_DB_PASSWORD")
    if not database_name or not table_name or not username or not password:
        return None
    host = os.getenv("ROBOT_DB_HOST", device.ip_address)
    port = int(os.getenv("ROBOT_DB_PORT", "3306"))
    return f"ssh+mysql://{host}:{port}/{database_name}/{table_name}"


def _latest_auto_backup_for_device(
    db: Session,
    device_id: int,
) -> Optional[models.Backup]:
    backups = _recent_auto_backups_for_device(db, device_id, limit=1)
    return backups[0] if backups else None


def _recent_auto_backups_for_device(
    db: Session,
    device_id: int,
    limit: int = 20,
) -> List[models.Backup]:
    return (
        db.query(models.Backup)
        .filter(
            models.Backup.device_id == device_id,
            models.Backup.backup_type == constants.BACKUP_TYPE_AUTO,
            models.Backup.backup_status == constants.BACKUP_STATUS_SUCCESS,
        )
        .order_by(models.Backup.created_at.desc(), models.Backup.backup_id.desc())
        .limit(limit)
        .all()
    )


def _should_create_full_baseline(
    *,
    recent_backups: List[models.Backup],
    device: models.Device,
    remote_paths: List[str],
    interval_days: int,
    forced: bool,
) -> bool:
    if forced:
        return True

    latest_baseline = _latest_full_baseline_backup(recent_backups, device, remote_paths)
    if not latest_baseline:
        return True

    return latest_baseline.created_at <= now_local() - timedelta(days=max(interval_days, 1))


def _latest_full_baseline_backup(
    backups: List[models.Backup],
    device: models.Device,
    remote_paths: List[str],
) -> Optional[models.Backup]:
    for backup in backups:
        if _is_full_baseline_backup(backup, device, remote_paths):
            return backup
    return None


def _is_full_baseline_backup(
    backup: models.Backup,
    device: models.Device,
    remote_paths: List[str],
) -> bool:
    manifest = _read_auto_backup_manifest(backup)
    if not manifest:
        return False

    backup_mode = manifest.get("backup_mode")
    if backup_mode == "full_baseline":
        return True

    paths = manifest.get("paths")
    if not isinstance(paths, dict):
        return False

    required_paths = {
        _normalize_remote_manifest_path(remote_path)
        for remote_path in remote_paths
    }
    database_path = _configured_robot_database_remote_path(device)
    if database_path:
        required_paths.add(_normalize_remote_manifest_path(database_path))

    if not required_paths:
        return False

    return required_paths.issubset(set(paths.keys()))


def _remote_snapshot_changed(
    snapshot: RemotePathSnapshot,
    latest_backup: Any,
    remote_path: str,
) -> bool:
    backups = _backup_history_list(latest_backup)
    if not backups:
        return True

    manifest_checksum = _manifest_checksum_for_remote_path_in_backups(backups, remote_path)
    if manifest_checksum:
        return snapshot.checksum != manifest_checksum

    latest_checksum = _latest_backup_checksum_for_remote_path_in_backups(backups, remote_path)
    if not latest_checksum:
        return True

    return snapshot.checksum != latest_checksum


def _backup_history_list(latest_backup: Any) -> List[models.Backup]:
    if not latest_backup:
        return []
    if isinstance(latest_backup, list):
        return latest_backup
    return [latest_backup]


def _manifest_checksum_for_remote_path_in_backups(
    backups: List[models.Backup],
    remote_path: str,
) -> Optional[str]:
    for backup in backups:
        checksum = _manifest_checksum_for_remote_path(backup, remote_path)
        if checksum:
            return checksum
    return None


def _latest_backup_checksum_for_remote_path_in_backups(
    backups: List[models.Backup],
    remote_path: str,
) -> Optional[str]:
    for backup in backups:
        checksum = _latest_backup_checksum_for_remote_path(backup, remote_path)
        if checksum:
            return checksum
    return None


def _latest_backup_checksum_for_remote_path(
    latest_backup: models.Backup,
    remote_path: str,
) -> Optional[str]:
    remote_path = remote_path.rstrip("/")
    remote_name = Path(remote_path).name
    remote_parts = {part.lower() for part in Path(remote_path).parts if part and part not in ("/", "\\")}
    if not remote_name and not remote_parts:
        return None

    best_match = None
    best_score = None

    for backup_file in latest_backup.files:
        file_path = Path(backup_file.file_path)
        file_name = file_path.name.lower()
        file_parts = {part.lower() for part in file_path.parts if part and part not in ("/", "\\")}

        if not file_name and not file_parts:
            continue

        score = 99
        if file_name == remote_name.lower():
            score = 0
        elif remote_name.lower() in file_parts:
            score = 1
        elif remote_name.lower() in file_name:
            score = 2
        elif remote_parts and remote_parts & file_parts:
            score = 3
        else:
            continue

        candidate = (score, len(file_path.parts), backup_file.checksum or "")
        if best_score is None or candidate[:2] < best_score[:2]:
            best_score = candidate
            best_match = backup_file.checksum

    return best_match


def _database_dump_changed(
    database_dump: List[DownloadedFile],
    latest_backup: Any,
) -> bool:
    backups = _backup_history_list(latest_backup)
    if not backups:
        return True

    # Consider changed if ANY split file has changed
    for dump_file in database_dump:
        manifest_checksum = _manifest_checksum_for_remote_path_in_backups(backups, dump_file.remote_path)
        if manifest_checksum:
            if manifest_checksum == dump_file.checksum:
                continue  # this split file unchanged
            latest_stable_checksum = _latest_database_backup_stable_checksum_in_backups(
                backups,
                dump_file.file_name,
            )
            if latest_stable_checksum:
                if latest_stable_checksum != dump_file.checksum:
                    return True
            elif manifest_checksum != dump_file.checksum:
                return True
            continue

        file_matched = False
        for backup in backups:
            for backup_file in backup.files:
                file_path = Path(backup_file.file_path)
                if (
                    file_path.exists()
                    and backup_file.file_name == dump_file.file_name
                    and backup_file.checksum
                ):
                    if backup_file.checksum != dump_file.checksum:
                        return True
                    file_matched = True
                    break
            if file_matched:
                break

        if not file_matched:
            database_stem = Path(dump_file.file_name).stem
            for backup in backups:
                for backup_file in backup.files:
                    if Path(backup_file.file_name).stem == database_stem and backup_file.checksum:
                        if backup_file.checksum != dump_file.checksum:
                            return True
                        file_matched = True
                        break
                if file_matched:
                    break

        if not file_matched:
            return True

    return False


def _latest_database_backup_stable_checksum_in_backups(
    backups: List[models.Backup],
    file_name: str,
) -> Optional[str]:
    for backup in backups:
        checksum = _latest_database_backup_stable_checksum(backup, file_name)
        if checksum:
            return checksum
    return None


def _latest_database_backup_stable_checksum(
    latest_backup: models.Backup,
    file_name: str,
) -> Optional[str]:
    for backup_file in latest_backup.files:
        if backup_file.file_name != file_name:
            continue

        file_path = Path(backup_file.file_path)
        if not file_path.exists():
            continue

        try:
            payload = json.loads(file_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        database = payload.get("database")
        table = payload.get("table")
        rows = payload.get("rows")
        if not isinstance(database, str) or not isinstance(table, str) or not isinstance(rows, list):
            continue
        if not all(isinstance(row, dict) for row in rows):
            continue

        return _database_payload_checksum(database, table, rows)

    return None


def _build_auto_backup_manifest(
    path_checks: List[Tuple[str, RemotePathSnapshot, bool]],
    database_dump: Optional[List[DownloadedFile]],
    backup_mode: str = "incremental",
) -> Dict[str, Any]:
    paths = {}
    for remote_path, snapshot, _ in path_checks:
        paths[_normalize_remote_manifest_path(remote_path)] = {
            "remote_path": remote_path,
            "checksum": snapshot.checksum,
            "modified_at": snapshot.modified_at.isoformat() if snapshot.modified_at else None,
            "is_directory": snapshot.is_directory,
            "size_bytes": snapshot.size_bytes,
        }

    if database_dump:
        for dump_file in database_dump:
            paths[_normalize_remote_manifest_path(dump_file.remote_path)] = {
                "remote_path": dump_file.remote_path,
                "checksum": dump_file.checksum,
                "modified_at": None,
                "is_directory": False,
                "size_bytes": None,
            }

    return {
        "version": 1,
        "backup_mode": backup_mode,
        "created_at": now_local().isoformat(),
        "paths": paths,
    }


def _write_auto_backup_manifest(local_path: Path, manifest: Dict[str, Any]) -> Path:
    local_path.mkdir(parents=True, exist_ok=True)
    manifest_path = local_path / _AUTO_BACKUP_MANIFEST_NAME
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    return manifest_path


def _manifest_checksum_for_remote_path(latest_backup: models.Backup, remote_path: str) -> Optional[str]:
    manifest = _read_auto_backup_manifest(latest_backup)
    if not manifest:
        return None
    paths = manifest.get("paths")
    if not isinstance(paths, dict):
        return None
    item = paths.get(_normalize_remote_manifest_path(remote_path))
    if not isinstance(item, dict):
        return None
    checksum = item.get("checksum")
    return checksum if isinstance(checksum, str) and checksum else None


def _read_auto_backup_manifest(latest_backup: models.Backup) -> Optional[Dict[str, Any]]:
    for backup_file in latest_backup.files:
        file_path = Path(backup_file.file_path)
        manifest = _read_manifest_near_backup_file(file_path)
        if manifest:
            return manifest
    return None


def _read_manifest_near_backup_file(file_path: Path) -> Optional[Dict[str, Any]]:
    if file_path.suffix.lower() == ".zip" and file_path.exists():
        try:
            with zipfile.ZipFile(file_path) as archive:
                with archive.open(_AUTO_BACKUP_MANIFEST_NAME) as manifest_file:
                    return json.loads(manifest_file.read().decode("utf-8"))
        except (KeyError, OSError, json.JSONDecodeError, zipfile.BadZipFile):
            return None

    for parent in [file_path.parent, *file_path.parents]:
        manifest_path = parent / _AUTO_BACKUP_MANIFEST_NAME
        if not manifest_path.exists():
            continue
        try:
            return json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
    return None


def _normalize_remote_manifest_path(remote_path: str) -> str:
    return remote_path.strip().replace("\\", "/").rstrip("/").lower()


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
    base_path = project_path(os.getenv("BACKUP_STORAGE_PATH", "storage/backups")) / "downloads"
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
    monthly_excess: bool = False,
) -> Optional[str]:
    if backup.backup_type != constants.BACKUP_TYPE_AUTO:
        return "Manual backup is protected"

    if keep_latest_per_device and not monthly_excess and _is_latest_backup_for_device(backup, db):
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
    backup_storage_root = project_path(os.getenv("BACKUP_STORAGE_PATH", "storage/backups")).resolve()
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
