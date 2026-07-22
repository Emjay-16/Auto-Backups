from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from api import schemas
from api.database import get_db
from api.services.upload_service import upload_files_to_device


router = APIRouter(
    prefix="/uploads",
    tags=["Uploads"],
)


@router.post("/", response_model=schemas.UploadRunResponse)
def upload_to_device(
    target_path: str = Form(...),
    uploaded_by: Optional[int] = Form(None),
    device_id: Optional[int] = Form(None),
    ip_address: Optional[str] = Form(None),
    device_name: Optional[str] = Form(None),
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
):
    return upload_files_to_device(
        db=db,
        files=files,
        target_path=target_path,
        uploaded_by=uploaded_by,
        device_id=device_id,
        ip_address=ip_address,
        device_name=device_name,
    )
