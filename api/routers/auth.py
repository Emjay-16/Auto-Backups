from fastapi import APIRouter, Depends, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from api import models, schemas
from api.database import get_db
from api.errors import api_exception
from api.security import create_access_token, get_current_user, hash_password, password_needs_rehash, verify_password


router = APIRouter(
    prefix="/auth",
    tags=["auth"],
)


@router.post("/login", response_model=schemas.LoginResponse)
def login(login_data: schemas.LoginRequest, db: Session = Depends(get_db)):
    try:
        user = (
            db.query(models.User)
            .filter(models.User.user_name == login_data.user_name)
            .first()
        )
    except SQLAlchemyError:
        raise api_exception(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "DATABASE_CONNECTION_FAILED",
            "Database connection failed",
        )

    if user is None or not verify_password(login_data.password, user.password):
        raise api_exception(
            status.HTTP_401_UNAUTHORIZED,
            "INVALID_LOGIN",
            "ชื่อ หรือ รหัสไม่ถูกต้อง",
        )

    if password_needs_rehash(user.password):
        user.password = hash_password(login_data.password)
        db.commit()
        db.refresh(user)

    return schemas.LoginResponse(
        user_id=user.user_id,
        user_name=user.user_name,
        role=user.role,
        access_token=create_access_token(user),
        message="Login success",
    )


@router.get("/me", response_model=schemas.UserResponse)
def me(current_user: models.User = Depends(get_current_user)):
    return current_user
