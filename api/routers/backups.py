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
from api.services.auto_backup_state import get_auto_backup_settings, update_auto_backup_settings
from api.services.backup_targets import (
    add_custom_auto_backup_path,
    delete_custom_auto_backup_path,
    get_custom_auto_backup_targets,
    save_backup_path_label,
)
from api.services.backup_service import (
    cleanup_old_backups,
    delete_backup,
    get_backup_detail,
    get_backup_download_zip,
    get_backup_history,
    run_auto_backups,
    run_combined_backup,
    safe_download_filename,
)
from api.services import enqueue_service


router = APIRouter(
    prefix="/backups",
    tags=["Backups"],
)


@router.get("/", response_model=List[schemas.BackupHistoryResponse])
def list_backups(
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """แสดงรายการสำรองข้อมูลทั้งหมด"""
    # NOTE: no stale sweep on reads — GET must not mutate job states
    # (see routers/jobs.py). Reaping runs in scheduler tick + write paths.
    return get_backup_history(db, limit)


@router.get("/cleanup/settings", response_model=schemas.AutoCleanupSettingsResponse)
def get_cleanup_settings():
    """แสดงการตั้งค่าการล้างข้อมูลอัตโนมัติ"""
    return get_auto_cleanup_settings()


@router.put("/cleanup/settings", response_model=schemas.AutoCleanupSettingsResponse)
def update_cleanup_settings(
    data: schemas.AutoCleanupSettingsRequest,
):
    """อัปเดตการตั้งค่าการล้างข้อมูลอัตโนมัติ"""
    return update_auto_cleanup_settings(
        enabled=data.enabled,
        older_than_days=data.older_than_days,
        older_than_hours=data.older_than_hours,
        interval_hours=data.interval_hours,
        keep_latest_per_device=data.keep_latest_per_device,
    )

@router.post("/cleanup", response_model=schemas.BackupCleanupResponse)
def cleanup_backups(
    data: schemas.BackupCleanupRequest,
    db: Session = Depends(get_db),
):
    """ล้างข้อมูลสำรองเก่า (sync — เก็บไว้เพื่อ backward compat)"""
    return cleanup_old_backups(data, db)


@router.post("/cleanup/enqueue", response_model=schemas.JobEnqueueResponse, status_code=202)
def enqueue_cleanup_backups(
    data: schemas.BackupCleanupRequest,
):
    """เข้าคิวล้างข้อมูลแบบ non-blocking — ตอบ 202 + job_id ทันที"""
    job_id = enqueue_service.enqueue_cleanup(data)
    return schemas.JobEnqueueResponse(
        job_id=job_id,
        job_type="cleanup",
        message="Cleanup queued, track progress at GET /jobs/{job_id}",
    )

@router.post("/auto", response_model=schemas.AutoBackupResponse)
def auto_backup(
    data: schemas.AutoBackupRequest,
    db: Session = Depends(get_db),
):
    """เรียกใช้การสำรองข้อมูลอัตโนมัติ (sync — ค้างจนงานเสร็จ, เก็บไว้เพื่อ backward compat)"""
    return run_auto_backups(data, db)


@router.post("/auto/enqueue", response_model=schemas.JobEnqueueResponse, status_code=202)
def enqueue_auto_backup(
    data: schemas.AutoBackupRequest,
):
    """เข้าคิวสำรองข้อมูลอัตโนมัติแบบ non-blocking — ตอบ 202 + job_id ทันที
    แล้วตามสถานะที่ GET /jobs/{job_id} (frontend poll /jobs อยู่แล้ว)"""
    job_id = enqueue_service.enqueue_auto_backup(data)
    return schemas.JobEnqueueResponse(
        job_id=job_id,
        job_type="auto_backup",
        message="Auto backup queued, track progress at GET /jobs/{job_id}",
    )


@router.get("/auto/settings", response_model=schemas.AutoBackupSettingsResponse)
def get_auto_backup_rule_settings():
    """แสดงการตั้งค่ากฎการสำรองข้อมูลอัตโนมัติ"""
    return get_auto_backup_settings()


@router.put("/auto/settings", response_model=schemas.AutoBackupSettingsResponse)
def update_auto_backup_rule_settings(
    data: schemas.AutoBackupSettingsRequest,
):
    """อัปเดตการตั้งค่ากฎการสำรองข้อมูลอัตโนมัติ"""
    return update_auto_backup_settings(
        enabled=data.enabled,
        interval_hours=data.interval_hours,
        full_baseline_interval_days=data.full_baseline_interval_days,
        zip_output=data.zip_output,
        run_on_startup=data.run_on_startup,
    )


@router.post("/combined", response_model=schemas.BackupRunResponse)
def combined_backup(
    data: schemas.CombinedBackupRequest,
    db: Session = Depends(get_db),
):
    """สำรองข้อมูล (sync — เก็บไว้เพื่อ backward compat)"""
    return run_combined_backup(data, db)


@router.post("/combined/enqueue", response_model=schemas.JobEnqueueResponse, status_code=202)
def enqueue_combined_backup(
    data: schemas.CombinedBackupRequest,
):
    """เข้าคิวสำรองข้อมูลแบบ non-blocking — ตอบ 202 + job_id ทันที"""
    job_id, _ = enqueue_service.enqueue_combined_backup(data)
    return schemas.JobEnqueueResponse(
        job_id=job_id,
        job_type="combined_backup",
        message="Combined backup queued, track progress at GET /jobs/{job_id}",
    )


@router.post("/auto-paths", response_model=schemas.CustomBackupPathResponse)
def add_auto_backup_path(
    data: schemas.CustomBackupPathRequest,
):
    """เพิ่ม path สำหรับสำรองข้อมูล"""
    try:
        target = add_custom_auto_backup_path(data.path, data.label)
    except ValueError as exc:
        raise api_exception(
            400,
            "INVALID_BACKUP_PATH",
            str(exc),
        )

    return schemas.CustomBackupPathResponse(
        path=target.path,
        label=target.label,
        message="Custom auto backup path saved",
    )


@router.get("/auto-paths", response_model=List[schemas.CustomBackupPathResponse])
def list_auto_backup_paths():
    """แสดง path สำรองข้อมูลที่เพิ่มเอง"""
    return [
        schemas.CustomBackupPathResponse(
            path=target.path,
            label=target.label,
            message="Custom auto backup path",
        )
        for target in get_custom_auto_backup_targets()
    ]


@router.delete("/auto-paths", response_model=schemas.CustomBackupPathResponse)
def delete_auto_backup_path(path: str):
    """ลบ path สำหรับสำรองข้อมูล"""
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
        label=path,
        message="Custom auto backup path deleted",
    )


@router.put("/auto-path-label", response_model=schemas.CustomBackupPathResponse)
def update_auto_backup_path_label(
    data: schemas.BackupPathLabelRequest,
):
    """อัปเดตชื่อของ path สำหรับสำรองข้อมูล"""
    try:
        target = save_backup_path_label(data.path, data.label)
    except ValueError as exc:
        raise api_exception(
            400,
            "INVALID_BACKUP_PATH_LABEL",
            str(exc),
        )

    return schemas.CustomBackupPathResponse(
        path=target.path,
        label=target.label,
        message="Backup path label saved",
    )


@router.get("/{backup_id}", response_model=schemas.BackupDetailResponse)
def get_backup(
    backup_id: int,
    db: Session = Depends(get_db),
):
    """แสดงรายละเอียดของสำรองข้อมูล"""
    return get_backup_detail(backup_id, db)


@router.get("/{backup_id}/download")
def download_backup(
    backup_id: int,
    file_ids: Optional[List[int]] = Query(None),
    filename: Optional[str] = None,
    token: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """ดาวน์โหลดไฟล์สำรองข้อมูล"""
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
    """ลบสำรองข้อมูล"""
    return delete_backup(backup_id, db)
