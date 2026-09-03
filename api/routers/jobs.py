from datetime import date as date_type
from datetime import datetime, time, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from api import models, schemas
from api.database import get_db
from api.errors import api_exception
from api.services.backup_service import recover_stale_running_records


router = APIRouter(
    prefix="/jobs",
    tags=["Jobs"],
)


@router.get("/", response_model=List[schemas.BackupJobResponse])
def list_jobs(
    job_type: Optional[str] = None,
    job_status: Optional[int] = None,
    device_id: Optional[int] = None,
    date: Optional[date_type] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    recover_stale_running_records(db)
    limit = max(1, min(limit, 500))
    query = db.query(models.BackupJob)

    if job_type:
        query = query.filter(models.BackupJob.job_type == job_type)
    if job_status is not None:
        query = query.filter(models.BackupJob.job_status == job_status)
    if device_id is not None:
        query = query.filter(models.BackupJob.device_id == device_id)
    if date is not None:
        start_at = datetime.combine(date, time.min)
        end_at = start_at + timedelta(days=1)
        query = query.filter(
            models.BackupJob.started_at >= start_at,
            models.BackupJob.started_at < end_at,
        )

    return (
        query.order_by(models.BackupJob.started_at.desc(), models.BackupJob.job_id.desc())
        .limit(limit)
        .all()
    )


@router.get("/{job_id}", response_model=schemas.BackupJobResponse)
def get_job(
    job_id: int,
    db: Session = Depends(get_db),
):
    recover_stale_running_records(db)
    job = (
        db.query(models.BackupJob)
        .filter(models.BackupJob.job_id == job_id)
        .first()
    )
    if not job:
        raise api_exception(
            404,
            "JOB_NOT_FOUND",
            "Job not found",
        )
    return job
