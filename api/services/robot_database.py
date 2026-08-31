import csv
import hashlib
import json
import os
import shlex
import socket
import time
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from api.services.sftp_backup import DownloadedFile


@dataclass
class DatabaseRestoreResult:
    database: str
    table: str
    row_count: int


def dump_mysql_table_to_json(
    host: str,
    username: str,
    password: str,
    database: str,
    table: str,
    output_path: Path,
    port: int = 3306,
) -> List[DownloadedFile]:
    try:
        import pymysql
    except ModuleNotFoundError as exc:
        raise RuntimeError("Missing dependency: install pymysql") from exc

    output_path.parent.mkdir(parents=True, exist_ok=True)
    _ensure_mysql_handshake(host, port, timeout=5)

    connection = pymysql.connect(
        host=host,
        port=port,
        user=username,
        password=password,
        database=database,
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=5,
        read_timeout=15,
        write_timeout=15,
    )

    try:
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT * FROM `{table}`")
            rows: List[Dict[str, Any]] = cursor.fetchall()
        rows = _expand_related_row_names(connection, rows)
    finally:
        connection.close()

    return _write_database_payload(
        database,
        table,
        rows,
        output_path,
        f"mysql://{host}:{port}/{database}/{table}",
    )


def dump_mysql_table_via_ssh(
    host: str,
    ssh_username: str,
    ssh_password: str,
    db_username: str,
    db_password: str,
    database: str,
    table: str,
    output_path: Path,
    ssh_port: int = 22,
    db_port: int = 3306,
) -> List[DownloadedFile]:
    try:
        import paramiko
    except ModuleNotFoundError as exc:
        raise RuntimeError("Missing dependency: install paramiko") from exc

    output_path.parent.mkdir(parents=True, exist_ok=True)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    query = f"SELECT * FROM {_quote_mysql_identifier(table)}"
    command = " ".join(
        [
            f"MYSQL_PWD={shlex.quote(db_password)}",
            "mysql",
            "--batch",
            "--raw",
            "-h",
            "127.0.0.1",
            "-P",
            str(db_port),
            "-u",
            shlex.quote(db_username),
            shlex.quote(database),
            "-e",
            shlex.quote(query),
        ]
    )

    try:
        _connect_ssh_with_retry(ssh, host, ssh_port, ssh_username, ssh_password)
        stdin, stdout, stderr = ssh.exec_command(command, timeout=60)
        output_data = stdout.read().decode("utf-8", errors="replace")
        error_data = stderr.read().decode("utf-8", errors="replace").strip()
        exit_status = stdout.channel.recv_exit_status()
    finally:
        ssh.close()

    if exit_status != 0:
        raise RuntimeError(error_data or f"mysql query failed with exit status {exit_status}")

    rows = _mysql_batch_output_to_rows(output_data)
    return _write_database_payload(
        database,
        table,
        rows,
        output_path,
        f"ssh+mysql://{host}:{db_port}/{database}/{table}",
    )


def restore_mysql_table_from_json(
    host: str,
    username: str,
    password: str,
    input_path: Path,
    port: int = 3306,
    database: Optional[str] = None,
    table: Optional[str] = None,
) -> DatabaseRestoreResult:
    try:
        import pymysql
    except ModuleNotFoundError as exc:
        raise RuntimeError("Missing dependency: install pymysql") from exc

    target_database, target_table, rows = _load_database_dump(input_path, database, table)
    _ensure_mysql_handshake(host, port, timeout=5)

    connection = pymysql.connect(
        host=host,
        port=port,
        user=username,
        password=password,
        database=target_database,
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
        connect_timeout=5,
        read_timeout=30,
        write_timeout=30,
    )

    try:
        with connection.cursor() as cursor:
            cursor.execute(f"DELETE FROM {_quote_mysql_identifier(target_table)}")
            if rows:
                columns = _ordered_row_columns(rows)
                placeholders = ", ".join(["%s"] * len(columns))
                column_sql = ", ".join(_quote_mysql_identifier(column) for column in columns)
                insert_sql = f"INSERT INTO {_quote_mysql_identifier(target_table)} ({column_sql}) VALUES ({placeholders})"
                values = [
                    tuple(row.get(column) for column in columns)
                    for row in rows
                ]
                cursor.executemany(insert_sql, values)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

    return DatabaseRestoreResult(
        database=target_database,
        table=target_table,
        row_count=len(rows),
    )


def restore_mysql_table_via_ssh(
    host: str,
    ssh_username: str,
    ssh_password: str,
    db_username: str,
    db_password: str,
    input_path: Path,
    ssh_port: int = 22,
    db_port: int = 3306,
    database: Optional[str] = None,
    table: Optional[str] = None,
) -> DatabaseRestoreResult:
    try:
        import paramiko
    except ModuleNotFoundError as exc:
        raise RuntimeError("Missing dependency: install paramiko") from exc

    target_database, target_table, rows = _load_database_dump(input_path, database, table)
    sql = _build_replace_table_sql(target_table, rows)
    command = " ".join(
        [
            f"MYSQL_PWD={shlex.quote(db_password)}",
            "mysql",
            "--binary-mode",
            "-h",
            "127.0.0.1",
            "-P",
            str(db_port),
            "-u",
            shlex.quote(db_username),
            shlex.quote(target_database),
        ]
    )

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        _connect_ssh_with_retry(ssh, host, ssh_port, ssh_username, ssh_password)
        stdin, stdout, stderr = ssh.exec_command(command, timeout=120)
        stdin.write(sql)
        stdin.channel.shutdown_write()
        error_data = stderr.read().decode("utf-8", errors="replace").strip()
        exit_status = stdout.channel.recv_exit_status()
    finally:
        ssh.close()

    if exit_status != 0:
        raise RuntimeError(error_data or f"mysql restore failed with exit status {exit_status}")

    return DatabaseRestoreResult(
        database=target_database,
        table=target_table,
        row_count=len(rows),
    )


def _write_database_payload(
    database: str,
    table: str,
    rows: List[Dict[str, Any]],
    output_path: Path,
    remote_path: str,
) -> List[DownloadedFile]:
    if not rows:
        return [_write_single_database_payload(database, table, rows, output_path, remote_path)]

    if "name" in rows[0]:
        return _write_database_payload_split_by_name(database, table, rows, output_path, remote_path)
    else:
        return [_write_single_database_payload(database, table, rows, output_path, remote_path)]


def _write_single_database_payload(
    database: str,
    table: str,
    rows: List[Dict[str, Any]],
    output_path: Path,
    remote_path: str,
) -> DownloadedFile:
    payload = {
        "database": database,
        "table": table,
        "row_count": len(rows),
        "dumped_at": datetime.now().astimezone().isoformat(),
        "rows": rows,
    }
    with output_path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2, default=_json_default)

    file_size_mb = os.path.getsize(output_path) / (1024 * 1024)
    return DownloadedFile(
        file_name=output_path.name,
        local_path=str(output_path),
        remote_path=remote_path,
        file_size_mb=file_size_mb,
        checksum=_database_payload_checksum(database, table, rows),
    )


def _write_database_payload_split_by_name(
    database: str,
    table: str,
    rows: List[Dict[str, Any]],
    output_path: Path,
    remote_path: str,
) -> List[DownloadedFile]:
    grouped_rows = _group_rows_by_name(rows)

    if len(grouped_rows) == 1:
        map_name = list(grouped_rows.keys())[0]
        map_rows = grouped_rows[map_name]
        return [_write_single_database_payload(database, table, map_rows, output_path, remote_path)]

    # Create a single folder: {stem}.ros_maps/
    stem = output_path.stem
    folder_name = f"{stem}.ros_maps"
    folder_path = output_path.parent / folder_name
    folder_path.mkdir(parents=True, exist_ok=True)

    result: List[DownloadedFile] = []

    for map_name, map_rows in sorted(grouped_rows.items()):
        safe_name = str(map_name).replace("/", "_").replace("\\", "_").replace(" ", "_")
        split_file_name = f"{safe_name}.json"
        split_output_path = folder_path / split_file_name
        split_remote_path = f"{remote_path}#{map_name}"

        payload = {
            "database": database,
            "table": table,
            "row_count": len(map_rows),
            "dumped_at": datetime.now().astimezone().isoformat(),
            "rows": map_rows,
        }
        with split_output_path.open("w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2, default=_json_default)

        file_size_mb = os.path.getsize(split_output_path) / (1024 * 1024)
        # file_name includes folder so _create_combined_auto_backup preserves folder structure
        result.append(DownloadedFile(
            file_name=f"{folder_name}/{split_file_name}",
            local_path=str(split_output_path),
            remote_path=split_remote_path,
            file_size_mb=file_size_mb,
            checksum=_database_payload_checksum(database, table, map_rows),
        ))

    return result if result else [_write_single_database_payload(database, table, rows, output_path, remote_path)]


def _group_rows_by_name(rows: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        name = row.get("name") or "_unnamed"
        if name not in grouped:
            grouped[name] = []
        grouped[name].append(row)
    return grouped


def _json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return value.hex()
    return str(value)


def _load_all_split_database_dumps(
    base_path: Path,
    stem: str,
) -> List[Dict[str, Any]]:
    """Load and merge all split database files from {stem}.ros_maps/ into one rows list"""
    ros_maps_dir = base_path.parent / f"{stem}.ros_maps"
    all_rows: List[Dict[str, Any]] = []

    if not ros_maps_dir.is_dir():
        return all_rows

    for split_file in sorted(ros_maps_dir.glob("*.json")):
        try:
            with split_file.open("r", encoding="utf-8") as file:
                payload = json.load(file)
                if isinstance(payload.get("rows"), list):
                    all_rows.extend(payload["rows"])
        except (OSError, ValueError):
            continue

    return all_rows


def _expand_related_row_names(
    connection,
    rows: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    if not rows:
        return rows

    lookup: Dict[str, Dict[Any, Any]] = {}
    for row in rows:
        for column_name in row:
            if not isinstance(column_name, str) or not column_name.endswith("_id"):
                continue
            definition = _related_name_definition(column_name)
            if definition is None:
                continue
            table_name, id_column, name_column = definition
            if column_name not in lookup:
                lookup[column_name] = {}
            value = row.get(column_name)
            if value in (None, ""):
                continue
            if value not in lookup[column_name]:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"SELECT `{id_column}` AS id_value, `{name_column}` AS name_value FROM `{table_name}` WHERE `{id_column}` = %s",
                        (value,),
                    )
                    result = cursor.fetchone()
                if result and result.get("name_value") is not None:
                    lookup[column_name][value] = result["name_value"]

    return _resolve_row_reference_names(rows, lookup)


def _resolve_row_reference_names(
    rows: List[Dict[str, Any]],
    lookup: Dict[str, Dict[Any, Any]],
) -> List[Dict[str, Any]]:
    resolved_rows: List[Dict[str, Any]] = []
    for row in rows:
        resolved = dict(row)
        for column_name, value_map in lookup.items():
            value = resolved.get(column_name)
            if value in (None, "") or value not in value_map:
                continue
            name_column = _related_name_definition(column_name)[2]
            if resolved.get(name_column) is None:
                resolved[name_column] = value_map[value]
        resolved_rows.append(resolved)
    return resolved_rows


def _related_name_definition(column_name: str) -> Optional[Tuple[str, str, str]]:
    aliases = {
        "device_id": ("devices", "device_id", "device_name"),
        "group_id": ("device_groups", "group_id", "group_name"),
        "user_id": ("users", "user_id", "user_name"),
        "created_by": ("users", "user_id", "user_name"),
        "requested_by": ("users", "user_id", "user_name"),
        "restored_by": ("users", "user_id", "user_name"),
        "backup_id": ("backups", "backup_id", "backup_name"),
    }
    return aliases.get(column_name)


def _ensure_mysql_handshake(host: str, port: int, timeout: int) -> None:
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            header = sock.recv(4)
    except OSError as exc:
        raise RuntimeError(f"MySQL port check failed: {exc}") from exc

    if len(header) < 4:
        raise RuntimeError("MySQL port check failed: incomplete handshake")


def _connect_ssh_with_retry(ssh, host: str, port: int, username: str, password: str) -> None:
    last_error = None
    for attempt in range(2):
        try:
            ssh.connect(
                hostname=host,
                port=port,
                username=username,
                password=password,
                timeout=10,
                banner_timeout=15,
                auth_timeout=15,
            )
            return
        except Exception as exc:
            last_error = exc
            if attempt == 0:
                time.sleep(1)

    raise last_error


def _mysql_batch_output_to_rows(output_data: str) -> List[Dict[str, Any]]:
    lines = output_data.splitlines()
    if not lines:
        return []

    reader = csv.reader(lines, delimiter="\t")
    headers = next(reader)
    rows = []

    for values in reader:
        row = {}
        for index, header in enumerate(headers):
            value = values[index] if index < len(values) else None
            row[header] = None if value == "NULL" else value
        rows.append(row)

    return rows


def _load_database_dump(
    input_path: Path,
    database_override: Optional[str],
    table_override: Optional[str],
) -> Tuple[str, str, List[Dict[str, Any]]]:
    try:
        with input_path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"Invalid database backup JSON: {exc}") from exc

    database = database_override or payload.get("database")
    table = table_override or payload.get("table")
    rows = payload.get("rows")

    if not database or not table or not isinstance(rows, list):
        raise RuntimeError("Invalid database backup JSON: database, table, and rows are required")

    for row in rows:
        if not isinstance(row, dict):
            raise RuntimeError("Invalid database backup JSON: every row must be an object")

    # Check if there is a {stem}.ros_maps/ folder with split files
    stem = input_path.stem
    ros_maps_dir = input_path.parent / f"{stem}.ros_maps"
    if ros_maps_dir.is_dir():
        all_rows: List[Dict[str, Any]] = []
        for split_file in sorted(ros_maps_dir.glob("*.json")):
            try:
                with split_file.open("r", encoding="utf-8") as file:
                    split_payload = json.load(file)
                    if isinstance(split_payload.get("rows"), list):
                        all_rows.extend(split_payload["rows"])
            except (OSError, ValueError):
                continue
        if all_rows:
            rows = all_rows

    return str(database), str(table), rows


def _build_replace_table_sql(table: str, rows: List[Dict[str, Any]]) -> str:
    statements = [
        "SET autocommit=0;",
        "START TRANSACTION;",
        f"DELETE FROM {_quote_mysql_identifier(table)};",
    ]

    if rows:
        columns = _ordered_row_columns(rows)
        column_sql = ", ".join(_quote_mysql_identifier(column) for column in columns)
        values_sql = ",\n".join(
            "(" + ", ".join(_mysql_literal(row.get(column)) for column in columns) + ")"
            for row in rows
        )
        statements.append(
            f"INSERT INTO {_quote_mysql_identifier(table)} ({column_sql}) VALUES\n{values_sql};"
        )

    statements.extend(["COMMIT;", "SET autocommit=1;"])
    return "\n".join(statements) + "\n"


def _ordered_row_columns(rows: List[Dict[str, Any]]) -> List[str]:
    columns = list(rows[0].keys())
    seen = set(columns)
    for row in rows[1:]:
        for column in row.keys():
            if column not in seen:
                seen.add(column)
                columns.append(column)
    return columns


def _mysql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float, Decimal)):
        return str(value)

    text = str(value)
    return "'" + (
        text
        .replace("\\", "\\\\")
        .replace("\0", "\\0")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\x1a", "\\Z")
        .replace("'", "\\'")
    ) + "'"


def _quote_mysql_identifier(identifier: str) -> str:
    return f"`{identifier.replace('`', '``')}`"


def _database_payload_checksum(database: str, table: str, rows: List[Dict[str, Any]]) -> str:
    payload = {
        "database": database,
        "table": table,
        "rows": _canonical_checksum_rows(rows),
    }
    data = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=_json_default)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _canonical_checksum_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        rows,
        key=lambda row: json.dumps(row, ensure_ascii=False, sort_keys=True, default=_json_default),
    )
