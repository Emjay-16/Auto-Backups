import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


BASE_URL = os.getenv("TEST_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
RUN_BACKUP = os.getenv("TEST_RUN_BACKUP", "0") == "1"
RUN_ROBOT_DB = os.getenv("TEST_RUN_ROBOT_DB", "0") == "1"
RUN_RESTORE = os.getenv("TEST_RUN_RESTORE", "0") == "1"


def main():
    load_api_env()
    started_at = int(time.time())
    group_id = None
    device_id = None
    backup_id = None

    try:
        step("health")
        get("/")

        step("device_groups API")
        group = post("/device-groups/", {"group_name": f"TEST_FLOW_{started_at}"})
        group_id = group["group_id"]
        get("/device-groups/")
        get(f"/device-groups/{group_id}")

        step("devices API")
        device_ip = os.getenv("TEST_DEVICE_IP", f"192.0.2.{started_at % 200 + 1}")
        device = post(
            "/devices/",
            {
                "group_id": group_id,
                "device_code": f"TEST-{started_at}",
                "device_name": "TEST DEVICE",
                "ip_address": device_ip,
                "device_status": 0,
                "last_seen_at": None,
            },
        )
        device_id = device["device_id"]
        get("/devices/")
        get(f"/devices/{device_id}")
        put(f"/devices/{device_id}", {"device_name": "TEST DEVICE UPDATED"})
        get(f"/devices/{device_id}/status")

        step("backups API list")
        get("/backups/")

        if RUN_BACKUP:
            step("SSH/SFTP backup flow")
            backup_id = run_file_backup()
            get(f"/backups/{backup_id}")
            download(f"/backups/{backup_id}/download")
        else:
            skip("SSH/SFTP backup flow", "set TEST_RUN_BACKUP=1 to run against a real robot")

        if RUN_ROBOT_DB:
            step("robot database backup flow")
            backup_id = run_robot_database_backup()
            get(f"/backups/{backup_id}")
            download(f"/backups/{backup_id}/download")
        else:
            skip("robot database backup flow", "set TEST_RUN_ROBOT_DB=1 to run against a real robot DB")

        if RUN_RESTORE and backup_id:
            step("restore flow")
            target_path = required_env("TEST_RESTORE_TARGET")
            post(f"/restore/{backup_id}", {"restored_by": 1, "target_path": target_path, "restore_type": 1})
        else:
            skip("restore flow", "set TEST_RUN_RESTORE=1 and TEST_RESTORE_TARGET to write files back")

        step("logs API")
        get("/logs/")
        if backup_id:
            get(f"/logs/?backup_id={backup_id}")

        print("\nPASS: test flow completed")
    finally:
        cleanup(device_id, group_id)


def run_file_backup():
    robot_ip = required_env("TEST_ROBOT_IP")
    remote_path = os.getenv("TEST_REMOTE_PATH") or required_env("ROBOT_NODE_RED_FLOW_PATH")
    response = post(
        "/backups/run",
        {
            "ip_address": robot_ip,
            "device_name": os.getenv("TEST_ROBOT_NAME", "TEST ROBOT"),
            "remote_paths": [remote_path],
            "created_by": env_int("TEST_CREATED_BY"),
            "backup_name": f"test_flow_file_{int(time.time())}",
            "backup_type": 1,
            "zip_output": False,
        },
    )
    return response["backup_id"]


def run_robot_database_backup():
    robot_ip = required_env("TEST_ROBOT_IP")
    response = post(
        "/backups/robot-db",
        {
            "ip_address": robot_ip,
            "device_name": os.getenv("TEST_ROBOT_NAME", "TEST ROBOT"),
            "created_by": env_int("TEST_CREATED_BY"),
            "backup_name": f"test_flow_db_{int(time.time())}",
            "database_name": os.getenv("TEST_DB_NAME") or os.getenv("ROBOT_DB_NAME"),
            "table_name": os.getenv("TEST_DB_TABLE") or os.getenv("ROBOT_DB_TABLE"),
            "backup_type": 1,
        },
    )
    return response["backup_id"]


def get(path):
    return request("GET", path)


def post(path, data):
    return request("POST", path, data)


def put(path, data):
    return request("PUT", path, data)


def delete(path):
    return request("DELETE", path)


def download(path):
    url = f"{BASE_URL}{path}"
    with urllib.request.urlopen(url, timeout=120) as response:
        payload = response.read()
    print(f"  OK GET {path} ({len(payload)} bytes)")
    return payload


def request(method, path, data=None):
    url = f"{BASE_URL}{path}"
    body = None
    headers = {}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request_obj = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request_obj, timeout=120) as response:
            payload = response.read()
            if not payload:
                print(f"  OK {method} {path}")
                return None
            parsed = json.loads(payload.decode("utf-8"))
            print(f"  OK {method} {path}")
            return parsed
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed: HTTP {exc.code} {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"{method} {path} failed: {exc}") from exc


def cleanup(device_id, group_id):
    if device_id is not None:
        try:
            delete(f"/devices/{device_id}")
        except Exception as exc:
            print(f"  WARN cleanup device failed: {exc}")

    if group_id is not None:
        try:
            delete(f"/device-groups/{group_id}")
        except Exception as exc:
            print(f"  WARN cleanup group failed: {exc}")


def load_api_env():
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key, value.strip().strip('"').strip("'"))


def required_env(name):
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def env_int(name):
    value = os.getenv(name)
    return int(value) if value else None


def step(name):
    print(f"\n== {name} ==")


def skip(name, reason):
    print(f"\n== {name} ==")
    print(f"  SKIP {reason}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"\nFAIL: {exc}", file=sys.stderr)
        sys.exit(1)
