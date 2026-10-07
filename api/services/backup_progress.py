import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


class BackupCancelledException(Exception):
    """Raised when backup execution is cancelled by the user."""
    pass


@dataclass
class ProgressState:
    device_id: int
    device_name: str
    status: str = "running"  # "running", "completed", "failed", "cancelled"
    stage: str = "preparing"  # "preparing", "discovering", "downloading", "saving", "compressing", "completed", "cancelled", "failed"
    current_target: str = ""
    current_file: str = ""
    file_index: int = 0
    total_files_estimate: int = 1
    file_bytes_transferred: int = 0
    file_bytes_total: int = 0
    file_percent: float = 0.0
    overall_percent: float = 0.0
    speed_bytes_sec: float = 0.0
    message: str = "กำลังเตรียมการสำรองข้อมูล..."
    started_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    cancel_event: threading.Event = field(default_factory=threading.Event)
    error_message: Optional[str] = None
    result: Optional[Dict[str, Any]] = None

    _last_bytes: int = 0
    _last_time: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        elapsed_sec = max(0, time.time() - self.started_at)
        return {
            "device_id": self.device_id,
            "device_name": self.device_name,
            "status": self.status,
            "stage": self.stage,
            "current_target": self.current_target,
            "current_file": self.current_file,
            "file_index": self.file_index,
            "total_files_estimate": self.total_files_estimate,
            "file_bytes_transferred": self.file_bytes_transferred,
            "file_bytes_total": self.file_bytes_total,
            "file_percent": round(self.file_percent, 1),
            "overall_percent": round(self.overall_percent, 1),
            "speed_kb_sec": round(self.speed_bytes_sec / 1024, 1),
            "elapsed_seconds": int(elapsed_sec),
            "message": self.message,
            "is_cancelled": self.cancel_event.is_set(),
            "error_message": self.error_message,
            "result": self.result,
        }


class BackupProgressTracker:
    def __init__(self):
        self._lock = threading.Lock()
        self._active: Dict[int, ProgressState] = {}

    def start(self, device_id: int, device_name: str, total_targets: int = 1) -> ProgressState:
        with self._lock:
            state = ProgressState(
                device_id=device_id,
                device_name=device_name,
                total_files_estimate=max(1, total_targets),
                status="running",
                stage="connecting",
                message=f"กำลังเชื่อมต่ออุปกรณ์ {device_name}...",
            )
            self._active[device_id] = state
            return state

    def get(self, device_id: int) -> Optional[Dict[str, Any]]:
        with self._lock:
            state = self._active.get(device_id)
            if state:
                return state.to_dict()
            return None

    def get_cancel_event(self, device_id: int) -> Optional[threading.Event]:
        with self._lock:
            state = self._active.get(device_id)
            return state.cancel_event if state else None

    def is_cancelled(self, device_id: int) -> bool:
        with self._lock:
            state = self._active.get(device_id)
            return state.cancel_event.is_set() if state else False

    def check_cancel(self, device_id: int):
        if self.is_cancelled(device_id):
            raise BackupCancelledException("การสำรองข้อมูลถูกยกเลิกโดยผู้ใช้")

    def cancel(self, device_id: int) -> bool:
        with self._lock:
            state = self._active.get(device_id)
            if state:
                state.cancel_event.set()
                state.status = "cancelled"
                state.stage = "cancelled"
                state.message = "ผู้ใช้ขอยกเลิกการสำรองข้อมูล..."
                state.updated_at = time.time()
                return True
            return False

    def update_stage(self, device_id: int, stage: str, message: str, overall_percent: Optional[float] = None):
        with self._lock:
            state = self._active.get(device_id)
            if not state or state.cancel_event.is_set():
                return
            state.stage = stage
            state.message = message
            if overall_percent is not None:
                state.overall_percent = min(100.0, max(0.0, overall_percent))
            state.updated_at = time.time()

    def update_granular(
        self,
        device_id: int,
        file_name: str,
        file_index: int,
        total_files: int,
        transferred_bytes: int,
        total_bytes: int,
        overall_transferred_bytes: int,
        overall_total_bytes: int,
    ):
        with self._lock:
            state = self._active.get(device_id)
            if not state or state.cancel_event.is_set():
                return
            now = time.time()
            state.stage = "downloading"
            state.current_file = file_name
            state.file_index = file_index
            state.total_files_estimate = total_files
            state.file_bytes_transferred = transferred_bytes
            state.file_bytes_total = total_bytes

            if total_bytes > 0:
                state.file_percent = min(100.0, (transferred_bytes / total_bytes) * 100.0)
            else:
                state.file_percent = 100.0

            if overall_total_bytes > 0:
                ratio = min(1.0, max(0.0, overall_transferred_bytes / overall_total_bytes))
                state.overall_percent = min(92.0, 5.0 + (ratio * 87.0))
            else:
                ratio = min(1.0, max(0.0, file_index / max(1, total_files)))
                state.overall_percent = min(92.0, 5.0 + (ratio * 87.0))

            dt = now - state._last_time
            if dt >= 0.3:
                delta_bytes = overall_transferred_bytes - state._last_bytes
                if delta_bytes > 0:
                    state.speed_bytes_sec = delta_bytes / dt
                state._last_bytes = overall_transferred_bytes
                state._last_time = now

            mb_overall_done = overall_transferred_bytes / (1024 * 1024)
            mb_overall_total = overall_total_bytes / (1024 * 1024)
            mb_file_done = transferred_bytes / (1024 * 1024)
            mb_file_total = total_bytes / (1024 * 1024)

            state.message = (
                f"กำลังดาวน์โหลด [{file_index}/{total_files}]: {file_name} "
                f"({mb_overall_done:.1f}/{mb_overall_total:.1f} MB - {state.overall_percent:.0f}%)"
            )
            state.updated_at = now

    def complete(self, device_id: int, result: Optional[Dict[str, Any]] = None):
        with self._lock:
            state = self._active.get(device_id)
            if state:
                state.status = "completed"
                state.stage = "completed"
                state.overall_percent = 100.0
                state.file_percent = 100.0
                total_f = state.total_files_estimate
                state.message = f"สำรองข้อมูลเสร็จสิ้นเรียบร้อย ({total_f} ไฟล์)"
                state.result = result
                state.updated_at = time.time()

    def fail(self, device_id: int, error_message: str):
        with self._lock:
            state = self._active.get(device_id)
            if state:
                if state.cancel_event.is_set():
                    state.status = "cancelled"
                    state.stage = "cancelled"
                    state.message = "ยกเลิกการสำรองข้อมูลแล้ว"
                else:
                    state.status = "failed"
                    state.stage = "failed"
                    state.error_message = error_message
                    state.message = f"การสำรองข้อมูลล้มเหลว: {error_message}"
                state.updated_at = time.time()

    def cleanup(self, device_id: int):
        with self._lock:
            self._active.pop(device_id, None)


progress_tracker = BackupProgressTracker()


class BackupProgressCallback:
    def __init__(self, tracker: BackupProgressTracker, device_id: int):
        self.tracker = tracker
        self.device_id = device_id

    def on_stage(self, stage: str, message: str, percent: Optional[float] = None):
        self.tracker.update_stage(self.device_id, stage, message, percent)

    def on_file_progress(
        self,
        file_name: str,
        file_index: int,
        total_files: int,
        transferred: int,
        total: int,
        overall_transferred: int,
        overall_total: int,
    ):
        self.tracker.update_granular(
            device_id=self.device_id,
            file_name=file_name,
            file_index=file_index,
            total_files=total_files,
            transferred_bytes=transferred,
            total_bytes=total,
            overall_transferred_bytes=overall_transferred,
            overall_total_bytes=overall_total,
        )
