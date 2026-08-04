import os
import shutil
import tempfile
from decimal import Decimal
from pathlib import Path
from typing import List, Optional

from fastapi import UploadFile, status
from sqlalchemy.orm import Session

from api import constants, models, schemas
from api.errors import api_exception
from api.services.device_resolver import resolve_device, resolve_user
from api.services.activity_log import log_activity
from api.services.sftp_backup import upload_files
from api.services.ssh_credentials import require_ssh_credentials
from api.utils.time import now_local


def upload_files_to_device(
    db: Session,
    files: List[UploadFile],
    target_path: str,
    uploaded_by: Optional[int] = None,
    device_id: Optional[int] = None,
    ip_address: Optional[str] = None,
    device_name: Optional[str] = None,
) -> schemas.UploadRunResponse:
    if not files:
        raise api_exception(
            status.HTTP_400_BAD_REQUEST,
            "UPLOAD_FILE_REQUIRED",
            "At least one file is required",
        )
    if not target_path:
        raise api_exception(
            status.HTTP_400_BAD_REQUEST,
            "TARGET_PATH_REQUIRED",
            "target_path is required",
        )

    device = resolve_device(db, device_id, ip_address, device_name)
    user = resolve_user(db, uploaded_by)

    username, password, port = require_ssh_credentials()

    uploaded_files = []

    with tempfile.TemporaryDirectory(prefix="robot-upload-") as temp_dir:
        temp_root = Path(temp_dir)
        local_paths = []

        for file in files:
            safe_name = Path(file.filename or "").name
            if not safe_name:
                raise api_exception(
                    status.HTTP_400_BAD_REQUEST,
                    "UPLOAD_FILE_NAME_REQUIRED",
                    "Every uploaded file must have a file name",
                )

            local_path = temp_root / safe_name
            with local_path.open("wb") as output:
                shutil.copyfileobj(file.file, output)

            local_paths.append(local_path)
            uploaded_files.append(
                schemas.UploadedFileResponse(
                    file_name=safe_name,
                    target_path=target_path,
                    file_size_mb=Decimal(str(local_path.stat().st_size / (1024 * 1024))),
                )
            )

        try:
            upload_files(
                host=device.ip_address,
                username=username,
                password=password,
                port=port,
                local_paths=local_paths,
                remote_root=target_path,
            )
        except RuntimeError as exc:
            _mark_device_offline(db, device)
            log_activity(
                db,
                user.user_id,
                device.device_id,
                None,
                "upload",
                constants.BACKUP_STATUS_FAILED,
                str(exc),
            )
            db.commit()
            raise api_exception(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "SFTP_UPLOAD_FAILED",
                str(exc),
            )
        except Exception as exc:
            message = f"SFTP upload failed: {exc}"
            _mark_device_offline(db, device)
            log_activity(
                db,
                user.user_id,
                device.device_id,
                None,
                "upload",
                constants.BACKUP_STATUS_FAILED,
                message,
            )
            db.commit()
            raise api_exception(
                status.HTTP_502_BAD_GATEWAY,
                "SFTP_UPLOAD_FAILED",
                message,
            )

    device.device_status = constants.DEVICE_STATUS_ONLINE
    device.last_seen_at = now_local()
    device.updated_at = now_local()
    log_activity(
        db,
        user.user_id,
        device.device_id,
        None,
        "upload",
        constants.BACKUP_STATUS_SUCCESS,
        f"Uploaded {len(uploaded_files)} file(s) to {target_path}",
    )
    db.commit()

    return schemas.UploadRunResponse(
        device_id=device.device_id,
        ip_address=device.ip_address,
        device_name=device.device_name,
        target_path=target_path,
        total_file=len(uploaded_files),
        files=uploaded_files,
        message="Upload completed",
    )


def _mark_device_offline(db: Session, device: models.Device) -> None:
    device.device_status = constants.DEVICE_STATUS_OFFLINE
    device.updated_at = now_local()
