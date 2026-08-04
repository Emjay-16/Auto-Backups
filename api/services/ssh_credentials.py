import os
from typing import Tuple

from fastapi import status

from api.errors import api_exception


def require_ssh_credentials() -> Tuple[str, str, int]:
    """Return (username, password, port) or raise a consistent API error."""
    username = os.getenv("ROBOT_SSH_USERNAME")
    password = os.getenv("ROBOT_SSH_PASSWORD")
    port = int(os.getenv("ROBOT_SSH_PORT", "22"))

    if not username or not password:
        raise api_exception(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "SSH_CREDENTIALS_MISSING",
            "ROBOT_SSH_USERNAME and ROBOT_SSH_PASSWORD are required",
        )

    return username, password, port