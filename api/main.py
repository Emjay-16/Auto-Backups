import os
import sys
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parents[1]))

from api import schemas
from api.database import SessionLocal
from api.errors import (
    http_exception_handler,
    sqlalchemy_exception_handler,
    unhandled_exception_handler,
    validation_exception_handler,
)
from api.routers import auth, backups, device_groups, devices, jobs, logs, restore, uploads
from api.services.api_token_auth import api_token_auth_middleware
from api.services.auto_backup_state import auto_backup_loop, pending_backup_loop
from api.services.backup_service import cleanup_old_backups, process_pending_auto_backups, run_auto_backups
from api.services.cleanup_state import auto_cleanup_loop

app = FastAPI(
    title="Auto Backup"
)

app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(SQLAlchemyError, sqlalchemy_exception_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)

default_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
env_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
origins = list(dict.fromkeys([*default_origins, *env_origins]))

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)
app.middleware("http")(api_token_auth_middleware)

app.include_router(auth.router)
app.include_router(backups.router)
app.include_router(device_groups.router)
app.include_router(devices.router)
app.include_router(jobs.router)
app.include_router(logs.router)
app.include_router(restore.router)
app.include_router(uploads.router)

_cleanup_stop_event = threading.Event()
_cleanup_thread = None
_backup_stop_event = threading.Event()
_backup_thread = None
_pending_backup_stop_event = threading.Event()
_pending_backup_thread = None


def _run_cleanup_from_settings(settings):
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
    finally:
        db.close()


def _run_backup_from_settings(settings):
    db = SessionLocal()
    try:
        run_auto_backups(
            schemas.AutoBackupRequest(
                zip_output=settings.zip_output,
            ),
            db,
        )
    finally:
        db.close()


def _run_pending_backups():
    db = SessionLocal()
    try:
        process_pending_auto_backups(db)
    finally:
        db.close()


@app.on_event("startup")
def start_background_jobs():
    global _backup_thread, _cleanup_thread, _pending_backup_thread
    _cleanup_stop_event.clear()
    _cleanup_thread = threading.Thread(
        target=auto_cleanup_loop,
        args=(_cleanup_stop_event, _run_cleanup_from_settings),
        daemon=True,
    )
    _cleanup_thread.start()

    _backup_stop_event.clear()
    _backup_thread = threading.Thread(
        target=auto_backup_loop,
        args=(_backup_stop_event, _run_backup_from_settings),
        daemon=True,
    )
    _backup_thread.start()

    _pending_backup_stop_event.clear()
    _pending_backup_thread = threading.Thread(
        target=pending_backup_loop,
        args=(_pending_backup_stop_event, _run_pending_backups),
        daemon=True,
    )
    _pending_backup_thread.start()


@app.on_event("shutdown")
def stop_background_jobs():
    _backup_stop_event.set()
    _cleanup_stop_event.set()
    _pending_backup_stop_event.set()
    if _backup_thread:
        _backup_thread.join(timeout=5)
    if _cleanup_thread:
        _cleanup_thread.join(timeout=5)
    if _pending_backup_thread:
        _pending_backup_thread.join(timeout=5)


@app.get("/")
async def root():
    return{
        "message": "Auto backup"
    }

if __name__ == "__main__":
     import uvicorn
     uvicorn.run(app, host="0.0.0.0", port=8000)
