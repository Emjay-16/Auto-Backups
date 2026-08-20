from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def project_path(path: str) -> Path:
    resolved_path = Path(path)
    if resolved_path.is_absolute():
        return resolved_path
    return PROJECT_ROOT / resolved_path
