import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable, Dict, Generic, TypeVar

T = TypeVar("T")


class JsonStateManager(Generic[T]):
    """Generic JSON-backed settings manager with thread-safe read/write."""

    def __init__(
        self,
        settings_type: type,
        env_file_key: str,
        default_file: str,
        env_defaults: Dict[str, Any],
        coerce: Callable[[Dict[str, Any], T], T],
    ):
        self._settings_type = settings_type
        self._env_file_key = env_file_key
        self._default_file = default_file
        self._env_defaults = env_defaults
        self._coerce = coerce
        self._settings = self._load_settings()
        self._lock = threading.Lock()

    def _settings_file(self) -> Path:
        return Path(os.getenv(self._env_file_key, self._default_file))

    def _env_settings(self) -> T:
        values = {}
        for key, default in self._env_defaults.items():
            raw = os.getenv(key, str(default))
            if isinstance(default, bool):
                values[key] = raw.lower() in {"true", "1", "yes", "on"}
            elif isinstance(default, int):
                values[key] = int(raw)
            else:
                values[key] = raw
        return self._settings_type(**values)

    def _load_settings(self) -> T:
        settings = self._env_settings()
        path = self._settings_file()
        if not path.exists():
            return settings
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return settings
        return self._coerce(data, settings)

    def _save_settings(self, settings: T) -> None:
        path = self._settings_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            field: getattr(settings, field)
            for field in settings.__dataclass_fields__
        }
        with tempfile.NamedTemporaryFile("w", delete=False, dir=path.parent, encoding="utf-8") as tmp:
            json.dump(payload, tmp, indent=2)
            tmp.write("\n")
            tmp_path = Path(tmp.name)
        tmp_path.replace(path)

    def _copy_settings(self) -> T:
        return self._settings_type(**{
            field: getattr(self._settings, field)
            for field in self._settings.__dataclass_fields__
        })

    def get(self) -> T:
        with self._lock:
            return self._copy_settings()

    def update(self, **kwargs: Any) -> T:
        with self._lock:
            for field, value in kwargs.items():
                if value is not None and hasattr(self._settings, field):
                    setattr(self._settings, field, value)
            self._save_settings(self._settings)
            return self._copy_settings()