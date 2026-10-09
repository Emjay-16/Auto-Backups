"""Non-blocking worker pool for heavy backup/cleanup tasks.

Replaces the pattern of running long SFTP work + ``time.sleep`` retries
inside the HTTP request thread. Callers create a ``BackupJob`` row first
(fast DB insert), submit the heavy function here, and return ``202`` with
``job_id`` immediately. The frontend already polls ``GET /jobs`` so it can
track progress without waiting for the SFTP transfer to finish.
"""

from __future__ import annotations

import logging
import os
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Callable

logger = logging.getLogger(__name__)

_executor: ThreadPoolExecutor | None = None
_lock = threading.Lock()


def get_executor() -> ThreadPoolExecutor:
    """Lazily create (and return) the shared worker pool."""
    global _executor
    with _lock:
        if _executor is None:
            max_workers = int(os.getenv("BACKUP_WORKER_MAX_WORKERS", "2"))
            _executor = ThreadPoolExecutor(
                max_workers=max(max_workers, 1),
                thread_name_prefix="backup-worker",
            )
        return _executor


def submit(func: Callable, *args, **kwargs) -> Future:
    """Submit *func* to the worker pool; logs failures so jobs never die silent."""
    executor = get_executor()
    future = executor.submit(func, *args, **kwargs)

    def _log_failure(done: Future) -> None:
        try:
            done.result()
        except Exception:
            logger.exception("Background backup task failed: %s", getattr(func, "__name__", func))

    future.add_done_callback(_log_failure)
    return future


def shutdown(wait: bool = False) -> None:
    """Shut down the worker pool (called on app shutdown)."""
    global _executor
    with _lock:
        executor, _executor = _executor, None
    if executor is not None:
        executor.shutdown(wait=wait, cancel_futures=True)
