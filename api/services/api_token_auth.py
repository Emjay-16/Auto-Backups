import hmac
import os

from fastapi import Request, status
from fastapi.responses import JSONResponse


EXEMPT_PATHS = {
    "/",
    "/auth/login",
    "/docs",
    "/openapi.json",
    "/redoc",
}


def _api_token() -> str:
    return os.getenv("API_AUTH_TOKEN", "").strip()


def _is_exempt_path(path: str) -> bool:
    return path in EXEMPT_PATHS or path.startswith("/docs/") or path.startswith("/redoc/")


async def api_token_auth_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)

    token = _api_token()
    if not token or _is_exempt_path(request.url.path):
        return await call_next(request)

    provided = _extract_token(request)
    if not provided or not hmac.compare_digest(provided, token):
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={
                "error_code": "UNAUTHORIZED",
                "message": "Missing or invalid API token",
                "status_code": status.HTTP_401_UNAUTHORIZED,
                "path": request.url.path,
            },
        )

    return await call_next(request)


def _extract_token(request: Request) -> str:
    auth_header = request.headers.get("authorization", "").strip()
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()

    return request.headers.get("x-api-token", "").strip()