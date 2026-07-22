import os
import socket
import uuid
from datetime import timedelta
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api import constants, models
from api.utils.time import now_local


def create_job(
    db: Session,
    job_type: str,
    requested_by: Optional[int] = None,
    device_id: Optional[int] = None,
    max_retries: int = 0,
    message: str = "Job started",
) -> models.BackupJob:
    now = now_local()
    job = models.BackupJob(
        job_type=job_type,
        job_status=constants.JOB_STATUS_RUNNING,
        device_id=device_id,
        requested_by=requested_by,
        total_devices=0,
        checked_devices=0,
        online_devices=0,
        offline_devices=0,
        backups_created=0,
        failed_devices=0,
        retry_count=0,
        max_retries=max_retries,
        job_message=message,
        started_at=now,
        updated_at=now,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def ensure_pending_auto_backup_job(
    db: Session,
    device_id: int,
    requested_by: Optional[int] = None,
    message: str = "Device offline, waiting for retry",
) -> models.BackupJob:
    job = (
        db.query(models.BackupJob)
        .filter(
            models.BackupJob.job_type == "auto_backup_pending",
            models.BackupJob.job_status == constants.JOB_STATUS_PENDING,
            models.BackupJob.device_id == device_id,
        )
        .order_by(models.BackupJob.started_at.desc(), models.BackupJob.job_id.desc())
        .first()
    )
    if job:
        return update_job(
            db,
            job,
            message=message,
        )

    now = now_local()
    job = models.BackupJob(
        job_type="auto_backup_pending",
        job_status=constants.JOB_STATUS_PENDING,
        device_id=device_id,
        requested_by=requested_by,
        total_devices=1,
        checked_devices=0,
        online_devices=0,
        offline_devices=1,
        backups_created=0,
        failed_devices=0,
        retry_count=0,
        max_retries=0,
        job_message=message,
        started_at=now,
        updated_at=now,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def update_job(
    db: Session,
    job: models.BackupJob,
    *,
    status: Optional[int] = None,
    backup_id: Optional[int] = None,
    total_devices: Optional[int] = None,
    checked_devices: Optional[int] = None,
    online_devices: Optional[int] = None,
    offline_devices: Optional[int] = None,
    backups_created: Optional[int] = None,
    failed_devices: Optional[int] = None,
    retry_count: Optional[int] = None,
    message: Optional[str] = None,
    finished: bool = False,
) -> models.BackupJob:
    if status is not None:
        job.job_status = status
    if backup_id is not None:
        job.backup_id = backup_id
    if total_devices is not None:
        job.total_devices = total_devices
    if checked_devices is not None:
        job.checked_devices = checked_devices
    if online_devices is not None:
        job.online_devices = online_devices
    if offline_devices is not None:
        job.offline_devices = offline_devices
    if backups_created is not None:
        job.backups_created = backups_created
    if failed_devices is not None:
        job.failed_devices = failed_devices
    if retry_count is not None:
        job.retry_count = retry_count
    if message is not None:
        job.job_message = message

    now = now_local()
    job.updated_at = now
    if finished:
        job.finished_at = now

    db.commit()
    db.refresh(job)
    return job


def acquire_job_lock(
    db: Session,
    lock_name: str,
    ttl_minutes: int = 180,
) -> Optional[str]:
    now = now_local()
    owner = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex}"
    expires_at = now + timedelta(minutes=max(ttl_minutes, 1))

    try:
        lock = (
            db.query(models.JobLock)
            .filter(models.JobLock.lock_name == lock_name)
            .with_for_update(nowait=True)
            .first()
        )
    except Exception:
        db.rollback()
        return None

    if lock and lock.expires_at > now:
        db.rollback()
        return None

    if not lock:
        lock = models.JobLock(lock_name=lock_name)
        db.add(lock)

    lock.locked_by = owner
    lock.locked_at = now
    lock.expires_at = expires_at

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return None

    return owner


def release_job_lock(db: Session, lock_name: str, owner: Optional[str]) -> None:
    if not owner:
        return

    lock = (
        db.query(models.JobLock)
        .filter(
            models.JobLock.lock_name == lock_name,
            models.JobLock.locked_by == owner,
        )
        .first()
    )
    if not lock:
        return

    db.delete(lock)
    db.commit()
