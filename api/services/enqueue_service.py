"""Non-blocking enqueue layer for heavy backup/cleanup endpoints.

Pattern per request (fast, <100ms, no SFTP in request thread):
1. Insert one ``BackupJob`` row (RUNNING, "Queued ...").
2. Submit the heavy work to :mod:`api.services.task_runner` with a **fresh**
   DB session — never reuse the request's session across threads.
3. Return ``202`` with ``job_id``; client polls ``GET /jobs/{job_id}``.

The sync endpoints (``POST /backups/auto`` etc.) are kept untouched for
backward compatibility.
"""

from __future__ import annotations

import logging
from typing import Optional

from api import schemas
from api.database import SessionLocal

logger = logging.getLogger(__name__)


def _run_auto_backup_in_worker(job_id: int, payload: dict) -> None:
    from api.services.backup_service import run_auto_backups

    data = schemas.AutoBackupRequest(**payload)
    db = SessionLocal()
    try:
        run_auto_backups(data, db, existing_job_id=job_id)
    except Exception as exc:
        # run_auto_backups already marks the job FAILED itself; this is
        # a last-resort guard for errors outside its try block (e.g. lock).
        logger.exception("Enqueued auto backup job %s failed: %s", job_id, exc)
        try:
            from api import constants
            from api.services.job_service import update_job

            job = _get_job(db, job_id)
            if job is not None:
                update_job(db, job, status=constants.JOB_STATUS_FAILED,
                           message=f"Auto backup failed: {exc}", finished=True)
        except Exception:
            logger.exception("Could not mark enqueued job %s as failed", job_id)
    finally:
        db.close()


def _run_combined_backup_in_worker(job_id: int, payload: dict) -> None:
    from api.services.backup_service import run_combined_backup

    data = schemas.CombinedBackupRequest(**payload)
    db = SessionLocal()
    try:
        run_combined_backup(data, db, existing_job_id=job_id)
    except Exception as exc:
        logger.exception("Enqueued combined backup job %s failed: %s", job_id, exc)
    finally:
        db.close()


def _run_cleanup_in_worker(job_id: int, payload: dict) -> None:
    from api import constants
    from api.services.backup_service import cleanup_old_backups
    from api.services.job_service import update_job

    data = schemas.BackupCleanupRequest(**payload)
    db = SessionLocal()
    try:
        job = _get_job(db, job_id)
        response = cleanup_old_backups(data, db)
        if job is not None:
            update_job(
                db, job,
                status=constants.JOB_STATUS_SUCCESS,
                message=(f"Cleanup completed: candidates={response.candidates}, "
                         f"deleted={response.deleted}, skipped={response.skipped}"),
                finished=True,
            )
    except Exception as exc:
        logger.exception("Enqueued cleanup job %s failed: %s", job_id, exc)
        try:
            from api.services.job_service import update_job as _update

            job = _get_job(db, job_id)
            if job is not None:
                _update(db, job, status=constants.JOB_STATUS_FAILED,
                        message=f"Cleanup failed: {exc}", finished=True)
        except Exception:
            logger.exception("Could not mark enqueued cleanup job %s as failed", job_id)
    finally:
        db.close()


def _get_job(db, job_id: int):
    from api import models

    return db.query(models.BackupJob).filter(models.BackupJob.job_id == job_id).first()


def enqueue_auto_backup(data: schemas.AutoBackupRequest) -> int:
    from api.services.job_service import create_job
    from api.services import task_runner

    db = SessionLocal()
    try:
        job = create_job(
            db,
            job_type="auto_backup",
            requested_by=data.created_by,
            message="Queued (non-blocking): waiting for worker",
        )
        job_id = job.job_id
    finally:
        db.close()
    task_runner.submit(_run_auto_backup_in_worker, job_id, data.model_dump())
    return job_id


def enqueue_combined_backup(data: schemas.CombinedBackupRequest) -> tuple[int, Optional[int]]:
    from api.services.job_service import create_job
    from api.services import task_runner

    db = SessionLocal()
    try:
        job = create_job(
            db,
            job_type="combined_backup",
            requested_by=data.created_by,
            device_id=data.device_id,
            message="Queued (non-blocking): waiting for worker",
        )
        job_id = job.job_id
    finally:
        db.close()
    task_runner.submit(_run_combined_backup_in_worker, job_id, data.model_dump())
    return job_id, data.device_id


def enqueue_cleanup(data: schemas.BackupCleanupRequest) -> int:
    from api.services.job_service import create_job
    from api.services import task_runner

    db = SessionLocal()
    try:
        job = create_job(
            db,
            job_type="cleanup",
            message="Queued (non-blocking): waiting for worker",
        )
        job_id = job.job_id
    finally:
        db.close()
    task_runner.submit(_run_cleanup_in_worker, job_id, data.model_dump())
    return job_id
