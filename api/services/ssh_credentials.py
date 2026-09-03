import os
from typing import Optional, Tuple

from fastapi import status

from api.errors import api_exception
from api.services.credential_crypto import decrypt_secret
from api import models


def require_ssh_credentials(device: Optional[models.Device] = None) -> Tuple[str, str, int]:
    """Return (username, password, port) for the given device, or raise a
    consistent API error.

    If `device` has its own ssh_username/ssh_password_encrypted set, those
    are used (fully independent from the fleet-wide defaults). Otherwise
    falls back to the global ROBOT_SSH_* values in .env, exactly as before —
    existing devices are unaffected unless a per-device override is added.
    """
    if device is not None and device.ssh_username and device.ssh_password_encrypted:
        username = device.ssh_username
        password = decrypt_secret(device.ssh_password_encrypted)
        port = device.ssh_port or 22
        return username, password, port

    username = os.getenv("ROBOT_SSH_USERNAME")
    password = os.getenv("ROBOT_SSH_PASSWORD")
    port = int(os.getenv("ROBOT_SSH_PORT", "22"))

    if not username or not password:
        raise api_exception(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "SSH_CREDENTIALS_MISSING",
            "ROBOT_SSH_USERNAME and ROBOT_SSH_PASSWORD are required"
            if device is None
            else f"No SSH credentials configured for {device.device_name}, and no fleet-wide default is set",
        )

    return username, password, port
