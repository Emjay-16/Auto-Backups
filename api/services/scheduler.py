"""APScheduler replacement for the 3 raw ``threading.Thread`` loops.

Old design (``api/main.py``): 3 daemon threads with ``while True`` +
hour-long ``Event.wait`` sleeps living inside the API process, plus heavy
SFTP work + ``time.sleep`` retries running inside the HTTP request thread.

New design:
- One ``BackgroundScheduler`` owns the 3 periodic ticks (auto backup,
  pending retry, cleanup). Intervals follow the JSON settings files and are
  re-applied via :func:`refresh_schedules` whenever settings change.
- Each tick opens its own DB session and reuses the existing sync logic in
  ``backup_service`` — no behavior change, only the triggering moves.
- One-off / on-demand runs go through ``task_runner`` so API returns fast.

NOTE: docker image must be rebuilt + container recreated before this takes
effect (new ``apscheduler`` dependency). Do NOT restart docker until asked.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional

logger = logging.getLogger(__name__)

_scheduler = None
_lock = threading.Lock()

AUTO_BACKUP_JOB_ID = "auto_backup_tick"
PENDING_BACKUP_JOB_ID = "pending_backup_tick"
AUTO_CLEANUP_JOB_ID = "auto_cleanup_tick"


# ---------------------------------------------------------------------------
# Tick functions (run in scheduler threads, each with a fresh DB session)
# ---------------------------------------------------------------------------

def tick_auto_backup() -> None:
    from api import schemas
    from api.database import SessionLocal
    from api.services.auto_backup_state import get_auto_backup_settings
    from api.services.backup_service import run_auto_backups

    settings = get_auto_backup_settings()
    if not settings.enabled:
        return
    db = SessionLocal()
    try:
        run_auto_backups(
            schemas.AutoBackupRequest(
                zip_output=settings.zip_output,
                full_baseline_interval_days=settings.full_baseline_interval_days,
            ),
            db,
        )
    except Exception:
        logger.exception("Scheduled auto backup failed")
    finally:
        db.close()


def tick_pending_backup() -> None:
    if os.getenv("AUTO_BACKUP_PENDING_ENABLED", "true").lower() != "true":
        return
    from api.database import SessionLocal
    from api.services.backup_service import (
        process_pending_auto_backups,
        recover_stale_running_records,
    )

    db = SessionLocal()
    try:
        recover_stale_running_records(db)
        process_pending_auto_backups(db)
    except Exception:
        logger.exception("Scheduled pending backup failed")
    finally:
        db.close()


def tick_auto_cleanup() -> None:
    from api import schemas
    from api.database import SessionLocal
    from api.services.backup_service import cleanup_old_backups
    from api.services.cleanup_state import get_auto_cleanup_settings

    settings = get_auto_cleanup_settings()
    if not settings.enabled:
        return
    db = SessionLocal()
    try:
        cleanup_old_backups(
            schemas.BackupCleanupRequest(
                older_than_days=settings.older_than_days,
                older_than_hours=settings.older_than_hours,
                keep_latest_per_device=settings.keep_latest_per_device,
            ),
            db,
        )
    except Exception:
        logger.exception("Scheduled auto cleanup failed")
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

def _current_intervals() -> tuple[int, int, int]:
    """Return (auto_backup_hours, pending_minutes, cleanup_hours)."""
    from api.services.auto_backup_state import get_auto_backup_settings
    from api.services.cleanup_state import get_auto_cleanup_settings

    auto_hours = max(get_auto_backup_settings().interval_hours, 1)
    cleanup_hours = max(get_auto_cleanup_settings().interval_hours, 1)
    try:
        pending_minutes = max(int(os.getenv("AUTO_BACKUP_PENDING_INTERVAL_MINUTES", "60")), 1)
    except ValueError:
        pending_minutes = 60
    return auto_hours, pending_minutes, cleanup_hours


def start_scheduler() -> None:
    """Start the scheduler (idempotent). Call once at app startup."""
    global _scheduler
    with _lock:
        if _scheduler is not None:
            return
        from apscheduler.schedulers.background import BackgroundScheduler

        auto_hours, pending_minutes, cleanup_hours = _current_intervals()
        _scheduler = BackgroundScheduler(
            {
                "apscheduler.job_defaults.coalesce": True,
                "apscheduler.job_defaults.max_instances": 1,
            }
        )
        _scheduler.add_job(tick_auto_backup, "interval", hours=auto_hours,
                           id=AUTO_BACKUP_JOB_ID, replace_existing=True)
        _scheduler.add_job(tick_pending_backup, "interval", minutes=pending_minutes,
                           id=PENDING_BACKUP_JOB_ID, replace_existing=True)
        _scheduler.add_job(tick_auto_cleanup, "interval", hours=cleanup_hours,
                           id=AUTO_CLEANUP_JOB_ID, replace_existing=True)
        _scheduler.start()
        logger.info(
            "Scheduler started: auto_backup=%sh pending=%sm cleanup=%sh",
            auto_hours, pending_minutes, cleanup_hours,
        )

    _maybe_run_on_startup()


def _maybe_run_on_startup() -> None:
    """Honor run_on_startup without blocking app startup (background submit)."""
    from api.services.auto_backup_state import get_auto_backup_settings
    from api.services import task_runner

    try:
        settings = get_auto_backup_settings()
    except Exception:
        return
    if settings.enabled and settings.run_on_startup:
        logger.info("run_on_startup is set, queueing one auto backup in background")
        task_runner.submit(tick_auto_backup)


def refresh_schedules() -> None:
    """Re-apply intervals after settings change. No-op if not started yet."""
    with _lock:
        scheduler = _scheduler
    if scheduler is None:
        return
    auto_hours, pending_minutes, cleanup_hours = _current_intervals()
    try:
        scheduler.reschedule_job(AUTO_BACKUP_JOB_ID, trigger="interval", hours=auto_hours)
        scheduler.reschedule_job(PENDING_BACKUP_JOB_ID, trigger="interval", minutes=pending_minutes)
        scheduler.reschedule_job(AUTO_CLEANUP_JOB_ID, trigger="interval", hours=cleanup_hours)
    except Exception:
        logger.exception("Failed to reschedule background jobs")
    else:
        logger.info(
            "Scheduler refreshed: auto_backup=%sh pending=%sm cleanup=%sh",
            auto_hours, pending_minutes, cleanup_hours,
        )


def shutdown_scheduler(wait: bool = False) -> None:
    """Stop the scheduler (idempotent). Call once at app shutdown."""
    global _scheduler
    with _lock:
        scheduler, _scheduler = _scheduler, None
    if scheduler is not None:
        try:
            scheduler.shutdown(wait=wait)
        except Exception:
            logger.exception("Error shutting down scheduler")


def is_running() -> bool:
    with _lock:
        return _scheduler is not None


def next_run_times() -> dict[str, Optional[str]]:
    """For health/debug: next fire time of each job (ISO strings)."""
    with _lock:
        scheduler = _scheduler
    if scheduler is None:
        return {"auto_backup": None, "pending_backup": None, "auto_cleanup": None}
    result: dict[str, Optional[str]] = {}
    for job_id, key in (
        (AUTO_BACKUP_JOB_ID, "auto_backup"),
        (PENDING_BACKUP_JOB_ID, "pending_backup"),
        (AUTO_CLEANUP_JOB_ID, "auto_cleanup"),
    ):
        job = scheduler.get_job(job_id)
        result[key] = job.next_run_time.isoformat() if job and job.next_run_time else None
    return result
