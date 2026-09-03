"""Symmetric encryption helpers for per-device SSH passwords.

The encryption key is read from the CREDENTIAL_ENCRYPTION_KEY environment
variable.  If the variable is absent the module falls back to a key that is
derived from the PostgreSQL connection string so that encrypted values
remain portable across restarts on the same machine without requiring an
explicit key.  For production deployments it is strongly recommended to set
CREDENTIAL_ENCRYPTION_KEY to a Fernet key generated once and stored
securely (e.g. `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`).
"""

from __future__ import annotations

import base64
import hashlib
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken


def _get_fernet() -> Fernet:
    raw_key = os.getenv("CREDENTIAL_ENCRYPTION_KEY", "").strip()
    if raw_key:
        # Accept both raw base64url Fernet keys and plain-text passphrases.
        try:
            key = raw_key.encode() if isinstance(raw_key, str) else raw_key
            # Fernet keys must be exactly 32 bytes when decoded.
            decoded = base64.urlsafe_b64decode(key + b"==")
            if len(decoded) == 32:
                return Fernet(key)
        except Exception:
            pass
        # Treat as a passphrase — derive a 32-byte key from it.
        derived = base64.urlsafe_b64encode(
            hashlib.sha256(raw_key.encode()).digest()
        )
        return Fernet(derived)

    # Fallback: derive from DATABASE_URL / POSTGRESQL_DB so restarts on the
    # same server keep the same key.
    db_url = os.getenv("DATABASE_URL") or os.getenv("POSTGRESQL_DB") or "fallback-auto-backup-key"
    derived = base64.urlsafe_b64encode(
        hashlib.sha256(db_url.encode()).digest()
    )
    return Fernet(derived)


def encrypt_secret(plaintext: Optional[str]) -> Optional[str]:
    """Encrypt *plaintext* and return a URL-safe base-64 ciphertext string.

    Returns ``None`` when *plaintext* is ``None`` or empty so callers can
    safely pass ``data.ssh_password`` without an extra guard.
    """
    if not plaintext:
        return None
    f = _get_fernet()
    return f.encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: Optional[str]) -> Optional[str]:
    """Decrypt a ciphertext produced by :func:`encrypt_secret`.

    Returns ``None`` when *ciphertext* is ``None`` or empty, and raises
    ``ValueError`` when the token is invalid (wrong key or corrupted data).
    """
    if not ciphertext:
        return None
    f = _get_fernet()
    try:
        return f.decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("Cannot decrypt credential: invalid token or wrong key") from exc

