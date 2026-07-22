from api import constants
from api.services.job_service import (
    acquire_job_lock,
    create_job,
    ensure_pending_auto_backup_job,
    release_job_lock,
    update_job,
)


def test_create_and_update_job(db_session, sample_user_device):
    user, device = sample_user_device

    job = create_job(
        db_session,
        job_type="backup",
        requested_by=user.user_id,
        device_id=device.device_id,
        message="started",
    )

    assert job.job_status == constants.JOB_STATUS_RUNNING
    assert job.job_message == "started"

    update_job(
        db_session,
        job,
        status=constants.JOB_STATUS_SUCCESS,
        checked_devices=1,
        online_devices=1,
        backups_created=1,
        message="done",
        finished=True,
    )

    assert job.job_status == constants.JOB_STATUS_SUCCESS
    assert job.finished_at is not None
    assert job.checked_devices == 1
    assert job.job_message == "done"


def test_job_lock_allows_one_owner_until_release(db_session):
    first_owner = acquire_job_lock(db_session, "auto_backup", ttl_minutes=10)
    second_owner = acquire_job_lock(db_session, "auto_backup", ttl_minutes=10)

    assert first_owner
    assert second_owner is None

    release_job_lock(db_session, "auto_backup", first_owner)
    third_owner = acquire_job_lock(db_session, "auto_backup", ttl_minutes=10)

    assert third_owner


def test_ensure_pending_auto_backup_job_reuses_existing_pending(db_session, sample_user_device):
    _, device = sample_user_device

    first = ensure_pending_auto_backup_job(db_session, device.device_id, message="offline")
    second = ensure_pending_auto_backup_job(db_session, device.device_id, message="still offline")

    assert first.job_id == second.job_id
    assert second.job_status == constants.JOB_STATUS_PENDING
    assert second.job_message == "still offline"
