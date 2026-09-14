import os
from pathlib import Path
from typing import Union

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def project_path(path: str) -> Path:
    resolved_path = Path(path)
    if resolved_path.is_absolute():
        return resolved_path
    return PROJECT_ROOT / resolved_path


def resolve_backup_file_path(file_path: Union[str, Path]) -> Path:
    path = Path(file_path)
    if path.exists():
        return path

    storage_root = project_path(os.getenv("BACKUP_STORAGE_PATH", "storage/backups"))
    parts = path.parts

    # Locate 'backups' marker in stored path and remap relative to current storage_root
    for idx, part in enumerate(parts):
        if part.lower() == "backups" and idx + 1 < len(parts):
            subpath = Path(*parts[idx + 1:])
            candidate = storage_root / subpath
            if candidate.exists():
                return candidate
            if storage_root.name.lower() != "backups":
                candidate2 = storage_root / "backups" / subpath
                if candidate2.exists():
                    return candidate2

    # Fallback: test subpaths against storage_root
    for idx in range(len(parts) - 1):
        candidate = storage_root / Path(*parts[idx:])
        if candidate.exists():
            return candidate

    return path

