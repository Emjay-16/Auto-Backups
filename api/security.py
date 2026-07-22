import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import timedelta
from typing import Optional

from fastapi import Depends, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from api import constants, models
from api.database import get_db
from api.errors import api_exception
from api.utils.time import now_local


PASSWORD_SCHEME = "pbkdf2_sha256"
PASSWORD_ITERATIONS = 260000
JWT_ALGORITHM = "HS256"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_ITERATIONS,
    )
    return "$".join(
        [
            PASSWORD_SCHEME,
            str(PASSWORD_ITERATIONS),
            _base64url_encode(salt),
            _base64url_encode(digest),
        ]
    )


def verify_password(password: str, stored_password: str) -> bool:
    if stored_password.startswith(f"{PASSWORD_SCHEME}$"):
        try:
            _, iterations_text, salt_text, digest_text = stored_password.split("$", 3)
            expected_digest = _base64url_decode(digest_text)
            actual_digest = hashlib.pbkdf2_hmac(
                "sha256",
                password.encode("utf-8"),
                _base64url_decode(salt_text),
                int(iterations_text),
            )
            return hmac.compare_digest(actual_digest, expected_digest)
        except (ValueError, TypeError):
            return False

    # Temporary compatibility for existing rows before password migration.
    return hmac.compare_digest(password, stored_password)


def password_needs_rehash(stored_password: str) -> bool:
    return not stored_password.startswith(f"{PASSWORD_SCHEME}${PASSWORD_ITERATIONS}$")


def create_access_token(user: models.User, expires_delta: Optional[timedelta] = None) -> str:
    expires_at = now_local() + (expires_delta or _default_token_lifetime())
    payload = {
        "sub": str(user.user_id),
        "user_name": user.user_name,
        "role": user.role,
        "exp": int(expires_at.timestamp()),
    }
    return _encode_jwt(payload)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    credentials_error = api_exception(
        status.HTTP_401_UNAUTHORIZED,
        "INVALID_ACCESS_TOKEN",
        "Invalid or expired access token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = _decode_jwt(token)
    if not payload:
        raise credentials_error

    user_id = payload.get("sub")
    if not user_id:
        raise credentials_error

    user = (
        db.query(models.User)
        .filter(models.User.user_id == int(user_id))
        .first()
    )
    if not user:
        raise credentials_error

    return user


def require_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    if current_user.role != constants.ROLE_ADMIN:
        raise api_exception(
            status.HTTP_403_FORBIDDEN,
            "ADMIN_REQUIRED",
            "Admin role is required",
        )
    return current_user


def _default_token_lifetime() -> timedelta:
    hours = os.getenv("JWT_ACCESS_TOKEN_EXPIRE_HOURS")
    if hours:
        return timedelta(hours=int(hours))

    minutes = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))
    return timedelta(minutes=minutes)


def _jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET_KEY")
    if secret:
        return secret
    # Development fallback only. Production should set JWT_SECRET_KEY.
    return "dev-only-change-this-secret"


def _encode_jwt(payload: dict) -> str:
    header = {
        "alg": JWT_ALGORITHM,
        "typ": "JWT",
    }
    header_text = _base64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_text = _base64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = _sign(f"{header_text}.{payload_text}")
    return f"{header_text}.{payload_text}.{signature}"


def _decode_jwt(token: str) -> Optional[dict]:
    try:
        header_text, payload_text, signature = token.split(".", 2)
    except ValueError:
        return None

    expected_signature = _sign(f"{header_text}.{payload_text}")
    if not hmac.compare_digest(signature, expected_signature):
        return None

    try:
        payload = json.loads(_base64url_decode(payload_text).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None

    expires_at = payload.get("exp")
    if not isinstance(expires_at, int) or expires_at < int(now_local().timestamp()):
        return None

    return payload


def _sign(value: str) -> str:
    signature = hmac.new(
        _jwt_secret().encode("utf-8"),
        value.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return _base64url_encode(signature)


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}")
