from typing import Any, Dict, Optional

from fastapi import HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError, SQLAlchemyError


def error_response(
    request: Request,
    status_code: int,
    error_code: str,
    message: str,
    detail: Optional[Any] = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error_code": error_code,
            "message": message,
            "detail": detail,
            "status_code": status_code,
            "path": request.url.path,
        },
    )


def http_error_detail(error_code: str, message: str, detail: Optional[Any] = None) -> Dict[str, Any]:
    return {
        "error_code": error_code,
        "message": message,
        "detail": detail,
    }


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict):
        error_code = str(exc.detail.get("error_code") or _error_code_from_status(exc.status_code))
        message = str(exc.detail.get("message") or _message_from_detail(exc.detail))
        detail = exc.detail.get("detail")
    else:
        message = str(exc.detail)
        error_code = _error_code_from_message(message, exc.status_code)
        detail = None

    return error_response(
        request=request,
        status_code=exc.status_code,
        error_code=error_code,
        message=message,
        detail=detail,
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return error_response(
        request=request,
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        error_code="VALIDATION_ERROR",
        message="Request validation failed",
        detail=exc.errors(),
    )


async def sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError) -> JSONResponse:
    if isinstance(exc, OperationalError):
        return error_response(
            request=request,
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            error_code="DATABASE_CONNECTION_FAILED",
            message="Database connection failed",
            detail=_safe_exception_message(exc),
        )

    return error_response(
        request=request,
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        error_code="DATABASE_ERROR",
        message="Database operation failed",
        detail=_safe_exception_message(exc),
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return error_response(
        request=request,
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        error_code="INTERNAL_SERVER_ERROR",
        message="Unexpected server error",
        detail=_safe_exception_message(exc),
    )


def _message_from_detail(detail: Dict[str, Any]) -> str:
    message = detail.get("message")
    if message:
        return str(message)
    return "Request failed"


def _error_code_from_status(status_code: int) -> str:
    if status_code == status.HTTP_400_BAD_REQUEST:
        return "BAD_REQUEST"
    if status_code == status.HTTP_401_UNAUTHORIZED:
        return "UNAUTHORIZED"
    if status_code == status.HTTP_403_FORBIDDEN:
        return "FORBIDDEN"
    if status_code == status.HTTP_404_NOT_FOUND:
        return "NOT_FOUND"
    if status_code == status.HTTP_409_CONFLICT:
        return "CONFLICT"
    if status_code == status.HTTP_422_UNPROCESSABLE_ENTITY:
        return "VALIDATION_ERROR"
    if status_code == status.HTTP_502_BAD_GATEWAY:
        return "UPSTREAM_CONNECTION_FAILED"
    if status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
        return "SERVICE_UNAVAILABLE"
    if status_code >= 500:
        return "SERVER_ERROR"
    return "REQUEST_ERROR"


def _error_code_from_message(message: str, status_code: int) -> str:
    normalized = message.lower()

    if "database connection" in normalized:
        return "DATABASE_CONNECTION_FAILED"
    if "database" in normalized and ("required" in normalized or "config" in normalized):
        return "ROBOT_DATABASE_CONFIG_MISSING"
    if "sftp" in normalized and ("failed" in normalized or "unable" in normalized):
        return "SFTP_CONNECTION_FAILED"
    if "ssh" in normalized and ("required" in normalized or "username" in normalized or "password" in normalized):
        return "SSH_CREDENTIALS_MISSING"
    if "not found" in normalized:
        if "device group" in normalized:
            return "DEVICE_GROUP_NOT_FOUND"
        if "device" in normalized:
            return "DEVICE_NOT_FOUND"
        if "backup file" in normalized:
            return "BACKUP_FILE_NOT_FOUND"
        if "backup" in normalized:
            return "BACKUP_NOT_FOUND"
        if "job" in normalized:
            return "JOB_NOT_FOUND"
        if "activity log" in normalized:
            return "ACTIVITY_LOG_NOT_FOUND"
        if "user" in normalized:
            return "USER_NOT_FOUND"
        return "RESOURCE_NOT_FOUND"
    if "already exists" in normalized:
        return "RESOURCE_ALREADY_EXISTS"
    if "already running" in normalized:
        return "JOB_ALREADY_RUNNING"
    if "invalid ip" in normalized:
        return "INVALID_IP_ADDRESS"
    if "path is required" in normalized or "target_path is required" in normalized:
        return "TARGET_PATH_REQUIRED"
    if "select at least" in normalized or "at least one" in normalized:
        return "SELECTION_REQUIRED"
    if "ชื่อ หรือ รหัสไม่ถูกต้อง" in message:
        return "INVALID_LOGIN"

    return _error_code_from_status(status_code)


def _safe_exception_message(exc: Exception) -> str:
    message = str(exc)
    return message[:500] if message else exc.__class__.__name__
