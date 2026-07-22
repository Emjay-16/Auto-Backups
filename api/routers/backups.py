from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from api import schemas
from api.database import get_db
from api.errors import api_exception
from api.services.cleanup_state import (
    get_auto_cleanup_settings,
    update_auto_cleanup_settings,
)
from api.services.backup_targets import add_custom_auto_backup_path, delete_custom_auto_backup_path
from api.services.backup_service import (
    cleanup_old_backups,
    delete_backup,
    get_backup_detail,
    get_backup_download_zip,
    get_backup_history,
    run_auto_backups,
    run_combined_backup,
    run_file_backup,
    run_robot_database_backup,
    safe_download_filename,
)


router = APIRouter(
    prefix="/backups",
    tags=["Backups"],
)


@router.get("/", response_model=List[schemas.BackupHistoryResponse])
def list_backups(
    limit: int = 50,
    db: Session = Depends(get_db),
):
    return get_backup_history(db, limit)


@router.get("/cleanup/settings", response_model=schemas.AutoCleanupSettingsResponse)
def get_cleanup_settings():
    return get_auto_cleanup_settings()


@router.put("/cleanup/settings", response_model=schemas.AutoCleanupSettingsResponse)
def update_cleanup_settings(
    data: schemas.AutoCleanupSettingsRequest,
):
    return update_auto_cleanup_settings(
        enabled=data.enabled,
        older_than_days=data.older_than_days,
        interval_hours=data.interval_hours,
        keep_latest_per_device=data.keep_latest_per_device,
    )


@router.post("/cleanup", response_model=schemas.BackupCleanupResponse)
def cleanup_backups(
    data: schemas.BackupCleanupRequest,
    db: Session = Depends(get_db),
):
    return cleanup_old_backups(data, db)


@router.post("/run", response_model=schemas.BackupRunResponse)
def run_backup(
    data: schemas.BackupRunRequest,
    db: Session = Depends(get_db),
):
    return run_file_backup(data, db)


@router.post("/auto", response_model=schemas.AutoBackupResponse)
def auto_backup(
    data: schemas.AutoBackupRequest,
    db: Session = Depends(get_db),
):
    return run_auto_backups(data, db)


@router.post("/robot-db", response_model=schemas.BackupRunResponse)
def backup_robot_database(
    data: schemas.RobotDatabaseBackupRequest,
    db: Session = Depends(get_db),
):
    return run_robot_database_backup(data, db)


@router.post("/combined", response_model=schemas.BackupRunResponse)
def combined_backup(
    data: schemas.CombinedBackupRequest,
    db: Session = Depends(get_db),
):
    return run_combined_backup(data, db)


@router.post("/auto-paths", response_model=schemas.CustomBackupPathResponse)
def add_auto_backup_path(
    data: schemas.CustomBackupPathRequest,
):
    try:
        path = add_custom_auto_backup_path(data.path)
    except ValueError as exc:
        raise api_exception(
            400,
            "INVALID_BACKUP_PATH",
            str(exc),
        )

    return schemas.CustomBackupPathResponse(
        path=path,
        message="Custom auto backup path saved",
    )


@router.delete("/auto-paths", response_model=schemas.CustomBackupPathResponse)
def delete_auto_backup_path(path: str):
    try:
        deleted = delete_custom_auto_backup_path(path)
    except ValueError as exc:
        raise api_exception(
            400,
            "INVALID_BACKUP_PATH",
            str(exc),
        )

    if not deleted:
        raise api_exception(
            404,
            "CUSTOM_BACKUP_PATH_NOT_FOUND",
            "Custom auto backup path not found",
        )

    return schemas.CustomBackupPathResponse(
        path=path,
        message="Custom auto backup path deleted",
    )


@router.get("/{backup_id}", response_model=schemas.BackupDetailResponse)
def get_backup(
    backup_id: int,
    db: Session = Depends(get_db),
):
    return get_backup_detail(backup_id, db)


@router.get("/{backup_id}/download")
def download_backup(
    backup_id: int,
    file_ids: Optional[List[int]] = Query(None),
    filename: Optional[str] = None,
    db: Session = Depends(get_db),
):
    zip_file = get_backup_download_zip(backup_id, db, file_ids)
    return FileResponse(
        path=str(zip_file),
        filename=safe_download_filename(filename, zip_file.name),
        media_type="application/zip",
    )


@router.delete("/{backup_id}", response_model=schemas.BackupDeleteResponse)
def remove_backup(
    backup_id: int,
    db: Session = Depends(get_db),
):
    return delete_backup(backup_id, db)
