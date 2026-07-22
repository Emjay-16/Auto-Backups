import errno
import hashlib
import os
import posixpath
import shutil
import stat
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

from api.utils.time import now_local


class RemotePathNotFound(RuntimeError):
    def __init__(self, remote_path: str):
        self.remote_path = remote_path
        super().__init__(f"Remote path not found: {remote_path}")


@dataclass
class DownloadedFile:
    file_name: str
    local_path: str
    remote_path: str
    file_size_mb: float
    checksum: str


@dataclass
class RemotePathSnapshot:
    remote_path: str
    is_directory: bool
    size_bytes: int
    modified_at: datetime
    checksum: str


@dataclass
class RemoteFileItem:
    name: str
    path: str
    file_type: str
    size_bytes: Optional[int]
    modified_at: datetime


def list_remote_path(
    host: str,
    username: str,
    password: str,
    remote_path: str,
    port: int = 22,
) -> List[RemoteFileItem]:
    try:
        import paramiko
    except ModuleNotFoundError as exc:
        raise RuntimeError("Missing dependency: install paramiko") from exc

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(
            hostname=host,
            port=port,
            username=username,
            password=password,
            timeout=10,
        )

        with ssh.open_sftp() as sftp:
            return _list_remote_path(sftp, remote_path)
    finally:
        ssh.close()


def download_paths(
    host: str,
    username: str,
    password: str,
    remote_paths: List[str],
    local_root: Path,
    port: int = 22,
) -> List[DownloadedFile]:
    try:
        import paramiko
    except ModuleNotFoundError as exc:
        raise RuntimeError("Missing dependency: install paramiko") from exc

    local_root.mkdir(parents=True, exist_ok=True)
    downloaded_files: List[DownloadedFile] = []

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(
            hostname=host,
            port=port,
            username=username,
            password=password,
            timeout=10,
        )

        with ssh.open_sftp() as sftp:
            for remote_path in remote_paths:
                remote_name = posixpath.basename(remote_path.rstrip("/\\")) or "root"
                _download_path(sftp, remote_path, local_root / remote_name, downloaded_files)
    finally:
        ssh.close()

    return downloaded_files


def upload_files(
    host: str,
    username: str,
    password: str,
    local_paths: List[Path],
    remote_root: str,
    port: int = 22,
) -> None:
    try:
        import paramiko
    except ModuleNotFoundError as exc:
        raise RuntimeError("Missing dependency: install paramiko") from exc

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(
            hostname=host,
            port=port,
            username=username,
            password=password,
            timeout=10,
        )

        local_root = Path(os.path.commonpath([str(path) for path in local_paths]))
        if local_root.is_file():
            local_root = local_root.parent

        with ssh.open_sftp() as sftp:
            for local_path in local_paths:
                relative_path = local_path.relative_to(local_root).as_posix()
                remote_path = posixpath.join(remote_root, relative_path)
                _ensure_remote_directory(sftp, posixpath.dirname(remote_path))
                sftp.put(str(local_path), remote_path)
    finally:
        ssh.close()


def upload_files_to_targets(
    host: str,
    username: str,
    password: str,
    transfers: List[Tuple[Path, str]],
    port: int = 22,
) -> None:
    try:
        import paramiko
    except ModuleNotFoundError as exc:
        raise RuntimeError("Missing dependency: install paramiko") from exc

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(
            hostname=host,
            port=port,
            username=username,
            password=password,
            timeout=10,
        )

        with ssh.open_sftp() as sftp:
            for local_path, remote_path in transfers:
                _ensure_remote_directory(sftp, posixpath.dirname(remote_path))
                sftp.put(str(local_path), remote_path)
    finally:
        ssh.close()


def snapshot_remote_path(
    host: str,
    username: str,
    password: str,
    remote_path: str,
    port: int = 22,
) -> RemotePathSnapshot:
    try:
        import paramiko
    except ModuleNotFoundError as exc:
        raise RuntimeError("Missing dependency: install paramiko") from exc

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(
            hostname=host,
            port=port,
            username=username,
            password=password,
            timeout=10,
        )
        with ssh.open_sftp() as sftp:
            return _snapshot_path(sftp, remote_path)
    finally:
        ssh.close()


def create_zip_archive(source_path: Path, archive_name: str) -> DownloadedFile:
    zip_base_path = source_path.parent / archive_name
    zip_path = Path(shutil.make_archive(str(zip_base_path), "zip", source_path))
    file_size_mb = os.path.getsize(zip_path) / (1024 * 1024)

    return DownloadedFile(
        file_name=zip_path.name,
        local_path=str(zip_path),
        remote_path=str(source_path),
        file_size_mb=file_size_mb,
        checksum=_sha256_file(zip_path),
    )


def _download_path(sftp, remote_path: str, local_path: Path, downloaded_files):
    remote_stat = _stat_remote_path(sftp, remote_path)

    if stat.S_ISDIR(remote_stat.st_mode):
        local_path.mkdir(parents=True, exist_ok=True)
        for item in sftp.listdir_attr(remote_path):
            child_remote_path = posixpath.join(remote_path, item.filename)
            child_local_path = local_path / item.filename
            _download_path(sftp, child_remote_path, child_local_path, downloaded_files)
        return

    local_path.parent.mkdir(parents=True, exist_ok=True)
    sftp.get(remote_path, str(local_path))

    file_size_mb = os.path.getsize(local_path) / (1024 * 1024)
    downloaded_files.append(
        DownloadedFile(
            file_name=local_path.name,
            local_path=str(local_path),
            remote_path=remote_path,
            file_size_mb=file_size_mb,
            checksum=_sha256_file(local_path),
        )
    )


def _list_remote_path(sftp, remote_path: str) -> List[RemoteFileItem]:
    remote_stat = _stat_remote_path(sftp, remote_path)
    if not stat.S_ISDIR(remote_stat.st_mode):
        return [_remote_file_item(remote_path, remote_stat)]

    items = []
    for item in sorted(sftp.listdir_attr(remote_path), key=lambda value: value.filename.lower()):
        item_path = posixpath.join(remote_path, item.filename)
        items.append(_remote_file_item(item_path, item))

    return sorted(items, key=lambda value: (value.file_type != "directory", value.name.lower()))


def _remote_file_item(remote_path: str, remote_stat) -> RemoteFileItem:
    is_directory = stat.S_ISDIR(remote_stat.st_mode)
    return RemoteFileItem(
        name=posixpath.basename(remote_path.rstrip("/")) or remote_path,
        path=remote_path,
        file_type="directory" if is_directory else "file",
        size_bytes=None if is_directory else remote_stat.st_size,
        modified_at=datetime.fromtimestamp(remote_stat.st_mtime),
    )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _snapshot_path(sftp, remote_path: str) -> RemotePathSnapshot:
    remote_stat = _stat_remote_path(sftp, remote_path)
    modified_at = datetime.fromtimestamp(remote_stat.st_mtime)

    if not stat.S_ISDIR(remote_stat.st_mode):
        return RemotePathSnapshot(
            remote_path=remote_path,
            is_directory=False,
            size_bytes=remote_stat.st_size,
            modified_at=modified_at,
            checksum=_sha256_remote_file(sftp, remote_path),
        )

    digest = hashlib.sha256()
    total_size = 0
    latest_mtime = remote_stat.st_mtime

    for item in _walk_remote_files(sftp, remote_path):
        relative_path, file_path, file_stat = item
        total_size += file_stat.st_size
        latest_mtime = max(latest_mtime, file_stat.st_mtime)
        digest.update(relative_path.encode("utf-8"))
        digest.update(str(file_stat.st_size).encode("ascii"))
        digest.update(_sha256_remote_file(sftp, file_path).encode("ascii"))

    return RemotePathSnapshot(
        remote_path=remote_path,
        is_directory=True,
        size_bytes=total_size,
        modified_at=datetime.fromtimestamp(latest_mtime),
        checksum=digest.hexdigest(),
    )


def _walk_remote_files(sftp, remote_root: str):
    stack = [(remote_root, "")]
    while stack:
        current_path, relative_root = stack.pop()
        for item in sorted(sftp.listdir_attr(current_path), key=lambda value: value.filename):
            child_path = posixpath.join(current_path, item.filename)
            relative_path = posixpath.join(relative_root, item.filename)
            if stat.S_ISDIR(item.st_mode):
                stack.append((child_path, relative_path))
            else:
                yield relative_path, child_path, item


def _sha256_remote_file(sftp, remote_path: str) -> str:
    digest = hashlib.sha256()
    with sftp.open(remote_path, "rb") as remote_file:
        for chunk in iter(lambda: remote_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _stat_remote_path(sftp, remote_path: str):
    try:
        return sftp.stat(remote_path)
    except OSError as exc:
        if getattr(exc, "errno", None) == errno.ENOENT or "No such file" in str(exc):
            raise RemotePathNotFound(remote_path) from exc
        raise


def _ensure_remote_directory(sftp, remote_path: str) -> None:
    remote_path = remote_path.replace("\\", "/")
    if not remote_path or remote_path in (".", "/"):
        return

    parts = [part for part in remote_path.strip("/").split("/") if part]
    if not parts:
        return

    current = ""
    for index, part in enumerate(parts):
        if index == 0 and part.endswith(":"):
            current = part
            continue

        if current:
            current = f"{current}/{part}"
        elif remote_path.startswith("/"):
            current = f"/{part}"
        else:
            current = part

        try:
            sftp.stat(current)
        except OSError:
            sftp.mkdir(current)


def build_backup_directory(base_path: str, device_name: str) -> Path:
    timestamp = now_local().strftime("%Y%m%d_%H%M%S")
    safe_device_name = device_name.replace("/", "_").replace("\\", "_").replace(" ", "_")
    return Path(base_path) / safe_device_name / timestamp
