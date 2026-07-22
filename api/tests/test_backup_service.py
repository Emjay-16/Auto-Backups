from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException

from api import constants, models, schemas
from api.services import backup_service


def _create_backup(db, device, user, name, created_at):
    backup = models.Backup(
        device_id=device.device_id,
        backup_name=name,
        backup_type=constants.BACKUP_TYPE_AUTO,
        backup_status=constants.BACKUP_STATUS_SUCCESS,
        total_file=1,
        total_size_mb=Decimal("1.00"),
        created_by=user.user_id,
        created_at=created_at,
        updated_at=created_at,
    )
    db.add(backup)
    db.commit()
    db.refresh(backup)
    return backup


def test_cleanup_skip_reason_only_protects_latest_backup(db_session, sample_user_device):
    user, device = sample_user_device
    old_backup = _create_backup(
        db_session,
        device,
        user,
        "old",
        datetime.now() - timedelta(days=2),
    )
    latest_backup = _create_backup(db_session, device, user, "latest", datetime.now())

    assert backup_service._backup_cleanup_skip_reason(
        old_backup,
        db_session,
        keep_latest_per_device=True,
    ) is None
    assert (
        backup_service._backup_cleanup_skip_reason(
            latest_backup,
            db_session,
            keep_latest_per_device=True,
        )
        == "Latest backup for this device"
    )


def test_auto_backup_memory_lock_returns_409(db_session, sample_user_device):
    backup_service._AUTO_BACKUP_LOCK.acquire()
    try:
        with pytest.raises(HTTPException) as exc_info:
            backup_service.run_auto_backups(schemas.AutoBackupRequest(device_ids=[1]), db_session)
    finally:
        backup_service._AUTO_BACKUP_LOCK.release()

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["error_code"] == "AUTO_BACKUP_ALREADY_RUNNING"
    assert db_session.query(models.BackupJob).count() == 1
    assert db_session.query(models.BackupJob).first().job_status == constants.JOB_STATUS_SKIPPED
