from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api import models, schemas
from api.database import get_db
from api.security import get_current_user


router = APIRouter(
    prefix="/jobs",
    tags=["Jobs"],
)


@router.get("/", response_model=List[schemas.BackupJobResponse])
def list_jobs(
    job_type: Optional[str] = None,
    job_status: Optional[int] = None,
    device_id: Optional[int] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    limit = max(1, min(limit, 500))
    query = db.query(models.BackupJob)

    if job_type:
        query = query.filter(models.BackupJob.job_type == job_type)
    if job_status is not None:
        query = query.filter(models.BackupJob.job_status == job_status)
    if device_id is not None:
        query = query.filter(models.BackupJob.device_id == device_id)

    return (
        query.order_by(models.BackupJob.started_at.desc(), models.BackupJob.job_id.desc())
        .limit(limit)
        .all()
    )


@router.get("/{job_id}", response_model=schemas.BackupJobResponse)
def get_job(
    job_id: int,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    job = (
        db.query(models.BackupJob)
        .filter(models.BackupJob.job_id == job_id)
        .first()
    )
    if not job:
        raise HTTPException(
            status_code=404,
            detail="Job not found",
        )
    return job
