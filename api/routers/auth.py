import hmac
import base64
import hashlib

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from api import models, schemas
from api.database import get_db


router = APIRouter(
    prefix="/auth",
    tags=["Auth"],
)


@router.post("/login", response_model=schemas.LoginResponse)
def login(data: schemas.LoginRequest, db: Session = Depends(get_db)):
    user_name = data.user_name.strip()
    user = (
        db.query(models.User)
        .filter(func.lower(models.User.user_name) == user_name.lower())
        .first()
    )

    if not user or not verify_password(data.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    if password_needs_bcrypt_rehash(user.password):
        user.password = hash_password(data.password)
        db.commit()

    return schemas.LoginResponse(
        user_id=user.user_id,
        user_name=user.user_name,
        role=user.role,
        message="Login successful",
    )


def verify_password(input_password: str, stored_password: str) -> bool:
    clean_input = input_password.strip()
    clean_stored = stored_password.strip()

    if is_bcrypt_hash(clean_stored):
        try:
            return bcrypt.checkpw(clean_input.encode("utf-8"), clean_stored.encode("utf-8"))
        except (TypeError, ValueError):
            return False

    if clean_stored.startswith("pbkdf2_sha256$"):
        return verify_django_pbkdf2_sha256(clean_input, clean_stored)

    return hmac.compare_digest(clean_input, clean_stored)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.strip().encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def password_needs_bcrypt_rehash(stored_password: str) -> bool:
    return not is_bcrypt_hash(stored_password.strip())


def is_bcrypt_hash(stored_password: str) -> bool:
    return stored_password.startswith(("$2a$", "$2b$", "$2y$"))


def verify_django_pbkdf2_sha256(input_password: str, stored_password: str) -> bool:
    try:
        algorithm, iterations, salt, stored_hash = stored_password.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            input_password.encode("utf-8"),
            salt.encode("utf-8"),
            int(iterations),
        )
        standard_hash = base64.b64encode(digest).decode("ascii")
        urlsafe_hash = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
        return hmac.compare_digest(standard_hash, stored_hash) or hmac.compare_digest(urlsafe_hash, stored_hash)
    except (TypeError, ValueError):
        return False
