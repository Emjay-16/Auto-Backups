import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parents[1]))

from api.database import SessionLocal
from api.errors import (
    http_exception_handler,
    sqlalchemy_exception_handler,
    unhandled_exception_handler,
    validation_exception_handler,
)
from api.routers import auth, backups, device_groups, devices, jobs, logs, restore, uploads
from api.services import task_runner
from api.services.api_token_auth import api_token_auth_middleware
from api.services.backup_service import recover_stale_running_records
from api.services.scheduler import (
    next_run_times,
    refresh_schedules,
    shutdown_scheduler,
    start_scheduler,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: mark interrupted RUNNING rows as failed, then start APScheduler
    # (replaces the 3 raw threading.Thread loops). One-off run_on_startup is
    # submitted to the worker pool without blocking startup.
    recovery_db = SessionLocal()
    try:
        recover_stale_running_records(recovery_db, is_startup=True)
    finally:
        recovery_db.close()

    start_scheduler()
    refresh_schedules()
    yield
    # Shutdown: stop scheduler first, then drain worker pool (no docker restart
    # needed for code changes alone — rebuild only to pick up new deps).
    shutdown_scheduler(wait=False)
    task_runner.shutdown(wait=False)


app = FastAPI(
    title="Auto Backup",
    lifespan=lifespan,
)

app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(SQLAlchemyError, sqlalchemy_exception_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)

default_origins = [
    "http://172.30.39.6:3000"
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
    allow_origin_regex=r"^https?://.*",
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


@app.get("/")
async def root():
    return{
        "message": "Auto backup"
    }


@app.get("/scheduler/status")
async def scheduler_status():
    """Ops/debug: next fire time of each background job (behind API token auth)."""
    return {
        "running": True,
        "next_run": next_run_times(),
    }
