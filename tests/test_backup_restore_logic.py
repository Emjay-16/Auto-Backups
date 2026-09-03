import json
import tempfile
import unittest
import zipfile
from datetime import timedelta
from unittest import mock
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from api import constants, models
from api.database import Base
from api.routers.restore import (
    _build_file_restore_transfers,
    _extract_restore_zip,
    _resolve_restore_target_path,
)
from api.services.backup_service import (
    _backup_file_remote_path,
    _build_auto_backup_manifest,
    _database_dump_changed,
    _dump_robot_database,
    _remote_snapshot_changed,
    _should_create_full_baseline,
    _write_auto_backup_manifest,
    recover_stale_running_records,
)
from api.services.robot_database import (
    _database_payload_checksum,
    _load_database_dump,
    _resolve_row_reference_names,
    _write_database_payload,
    _write_single_database_payload,
)
from api.services.sftp_backup import DownloadedFile, RemotePathSnapshot
from api.utils.time import now_local


class BackupRetentionLimitTests(unittest.TestCase):
    def test_monthly_backup_excess_is_counted_per_device_and_ignores_manual_backups(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=engine)
        session_factory = sessionmaker(bind=engine)
        db = session_factory()

        try:
            group = models.DeviceGroup(group_id=1, group_name="Fleet")
            db.add(group)
            db.flush()

            user = models.User(user_name="tester", password="secret", role=1)
            db.add(user)
            db.flush()

            device_one = models.Device(
                device_id=1,
                group_id=group.group_id,
                device_code="AMR01",
                device_name="AMR01",
                ip_address="10.0.0.1",
                device_status=constants.DEVICE_STATUS_ONLINE,
                auto_backup_enabled=True,
                created_at=now_local(),
                updated_at=now_local(),
            )
            device_two = models.Device(
                device_id=2,
                group_id=group.group_id,
                device_code="AMR02",
                device_name="AMR02",
                ip_address="10.0.0.2",
                device_status=constants.DEVICE_STATUS_ONLINE,
                auto_backup_enabled=True,
                created_at=now_local(),
                updated_at=now_local(),
            )
            db.add_all([device_one, device_two])
            db.flush()

            now = now_local()
            for index in range(5):
                db.add(
                    models.Backup(
                        device_id=device_one.device_id,
                        backup_name=f"auto-{index}",
                        backup_type=constants.BACKUP_TYPE_AUTO,
                        backup_status=constants.BACKUP_STATUS_SUCCESS,
                        total_file=1,
                        total_size_mb=0,
                        created_by=user.user_id,
                        created_at=now - timedelta(days=index),
                        updated_at=now,
                    )
                )

            db.add(
                models.Backup(
                    device_id=device_one.device_id,
                    backup_name="manual-backup",
                    backup_type=constants.BACKUP_TYPE_SELECTED,
                    backup_status=constants.BACKUP_STATUS_SUCCESS,
                    total_file=1,
                    total_size_mb=0,
                    created_by=user.user_id,
                    created_at=now - timedelta(days=1),
                    updated_at=now,
                )
            )

            db.add_all(
                [
                    models.Backup(
                        device_id=device_two.device_id,
                        backup_name="device-two-auto-1",
                        backup_type=constants.BACKUP_TYPE_AUTO,
                        backup_status=constants.BACKUP_STATUS_SUCCESS,
                        total_file=1,
                        total_size_mb=0,
                        created_by=user.user_id,
                        created_at=now - timedelta(days=2),
                        updated_at=now,
                    ),
                    models.Backup(
                        device_id=device_two.device_id,
                        backup_name="device-two-auto-2",
                        backup_type=constants.BACKUP_TYPE_AUTO,
                        backup_status=constants.BACKUP_STATUS_SUCCESS,
                        total_file=1,
                        total_size_mb=0,
                        created_by=user.user_id,
                        created_at=now - timedelta(days=3),
                        updated_at=now,
                    ),
                ]
            )
            db.commit()

            excess = _monthly_backup_excess(db, max_per_month=4)

            self.assertEqual(len(excess), 1)
            self.assertEqual(excess[0].device_id, device_one.device_id)
            self.assertEqual(excess[0].backup_name, "auto-4")
        finally:
            db.close()


class StaleRunningRecordRecoveryTests(unittest.TestCase):
    def test_recover_stale_running_records_clears_stale_jobs_and_locks(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=engine)
        session_factory = sessionmaker(bind=engine)
        db = session_factory()

        try:
            stale_time = now_local() - timedelta(hours=2)
            stale_job = models.BackupJob(
                job_type="auto_backup",
                job_status=constants.JOB_STATUS_RUNNING,
                total_devices=1,
                checked_devices=0,
                online_devices=0,
                offline_devices=1,
                backups_created=0,
                failed_devices=0,
                retry_count=0,
                max_retries=3,
                job_message="stale",
                started_at=stale_time,
                updated_at=stale_time,
            )
            db.add(stale_job)
            db.add(
                models.JobLock(
                    lock_name="auto_backup",
                    locked_by="test-host:999999:deadbeef",
                    locked_at=stale_time,
                    expires_at=stale_time + timedelta(minutes=5),
                )
            )
            db.commit()

            recovered_backups, recovered_jobs = recover_stale_running_records(db, max_age_hours=1)

            self.assertEqual(recovered_backups, 0)
            self.assertEqual(recovered_jobs, 1)
            self.assertEqual(db.query(models.BackupJob).first().job_status, constants.JOB_STATUS_FAILED)
            self.assertEqual(db.query(models.JobLock).count(), 0)
        finally:
            db.close()


class RestoreZipTests(unittest.TestCase):
    def test_extract_restore_zip_skips_manifest_and_keeps_structure(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            zip_path = root / "maps.zip"
            with zipfile.ZipFile(zip_path, "w") as archive:
                archive.writestr(".auto_backup_manifest.json", "{}")
                archive.writestr("MapA/MapA.json", "{}")
                archive.writestr("MapA/MapA.pgm", "PGM")

            extracted = _extract_restore_zip(zip_path, root / "extract")

            self.assertEqual(
                sorted(path.relative_to(root / "extract").as_posix() for path in extracted),
                ["MapA/MapA.json", "MapA/MapA.pgm"],
            )

    def test_extract_restore_zip_rejects_unsafe_member_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            zip_path = root / "unsafe.zip"
            with zipfile.ZipFile(zip_path, "w") as archive:
                archive.writestr("../outside.txt", "bad")

            with self.assertRaisesRegex(RuntimeError, "Unsafe zip member path"):
                _extract_restore_zip(zip_path, root / "extract")

    def test_multi_file_zip_restore_requires_folder_target_and_preserves_paths(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            zip_path = root / "maps.zip"
            with zipfile.ZipFile(zip_path, "w") as archive:
                archive.writestr("MapA/MapA.json", "{}")
                archive.writestr("MapA/MapA.pgm", "PGM")

            restore_items = [
                {
                    "file": SimpleNamespace(file_path=str(zip_path)),
                    "resolved_target_path": "/home/matrix/maps",
                }
            ]

            transfers = _build_file_restore_transfers(restore_items, root / "extract")

            self.assertEqual(
                [target for _, target in transfers],
                ["/home/matrix/maps/MapA/MapA.json", "/home/matrix/maps/MapA/MapA.pgm"],
            )

            restore_items[0]["resolved_target_path"] = "/home/matrix/maps.zip"
            with self.assertRaisesRegex(RuntimeError, "target must be a directory"):
                _build_file_restore_transfers(restore_items, root / "extract2")

    def test_resolve_restore_target_path_handles_file_and_folder_targets(self):
        self.assertEqual(
            _resolve_restore_target_path(Path("flows.json"), "/home/matrix/node-red/"),
            "/home/matrix/node-red/flows.json",
        )
        self.assertEqual(
            _resolve_restore_target_path(Path("flows.json"), "/home/matrix/node-red/flows.json"),
            "/home/matrix/node-red/flows.json",
        )
        self.assertEqual(
            _resolve_restore_target_path(Path("flows.json"), "/home/matrix/node-red"),
            "/home/matrix/node-red/flows.json",
        )


class MapDumpFormatTests(unittest.TestCase):
    def test_dump_robot_database_returns_iterable_list_for_single_map_dump(self):
        device = SimpleNamespace(ip_address="10.0.0.1")
        expected = DownloadedFile(
            file_name="G2F.json",
            local_path="/tmp/G2F.json",
            remote_path="ssh+mysql://10.0.0.1:3306/istuvd/ros_maps",
            file_size_mb=1.0,
            checksum="abc123",
        )

        with mock.patch("api.services.backup_service.dump_mysql_table_to_json", return_value=expected):
            result = _dump_robot_database(
                device=device,
                output_path=Path("/tmp/ros_maps.json"),
                database_name="istuvd",
                table_name="ros_maps",
            )

        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0], expected)

    def test_ros_maps_row_is_written_without_database_wrapper(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "G2F.json"
            row = {
                "id": 999,
                "name": "G2F",
                "objects": '[{"type":13,"name":"Wall"}]',
                "description": "Merged POI G2F",
                "is_default": "0",
                "move_speed": "0.5",
                "uvc_speed": "0.2",
            }

            _write_single_database_payload("istuvd", "ros_maps", [row], output_path, "remote/path")
            payload = json.loads(output_path.read_text(encoding="utf-8"))

            self.assertEqual(
                payload,
                {
                    "name": "G2F",
                    "objects": '[{"type":13,"name":"Wall"}]',
                    "description": "Merged POI G2F",
                    "is_default": "0",
                    "move_speed": "0.5",
                    "uvc_speed": "0.2",
                },
            )
            self.assertNotIn("database", payload)
            self.assertNotIn("table", payload)
            self.assertNotIn("rows", payload)

    def test_load_database_dump_accepts_direct_map_row_object(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "G2F.json"
            input_path.write_text(
                json.dumps(
                    {
                        "name": "G2F",
                        "objects": '[{"type":13,"name":"Wall"}]',
                        "description": "Merged POI G2F",
                        "is_default": "0",
                        "move_speed": "0.5",
                        "uvc_speed": "0.2",
                    }
                ),
                encoding="utf-8",
            )

            database, table, rows = _load_database_dump(input_path, "istuvd", "ros_maps")

            self.assertEqual(database, "istuvd")
            self.assertEqual(table, "ros_maps")
            self.assertEqual(rows[0]["name"], "G2F")
            self.assertEqual(rows[0]["description"], "Merged POI G2F")

    def test_ros_maps_multiple_rows_are_split_by_name(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "istuvd_ros_maps.json"
            rows = [
                {
                    "id": 1,
                    "name": "G2F",
                    "objects": '[{"type":13,"name":"Wall"}]',
                    "description": "Merged POI G2F",
                },
                {
                    "id": 2,
                    "name": "SMR02",
                    "objects": '[{"type":9,"name":"Hall"}]',
                    "description": "Merged POI SMR02",
                },
            ]

            result = _write_database_payload(
                "istuvd",
                "ros_maps",
                rows,
                output_path,
                "ssh+mysql://10.0.0.1:3306/istuvd/ros_maps",
            )

            self.assertIsInstance(result, list)
            self.assertEqual({item.file_name for item in result}, {"G2F.json", "SMR02.json"})
            self.assertTrue((Path(temp_dir) / "istuvd" / "G2F.json").exists())
            self.assertTrue((Path(temp_dir) / "istuvd" / "SMR02.json").exists())


class AutoBackupChangeDetectionTests(unittest.TestCase):
    def test_multi_path_manifest_resolves_file_remote_path_from_backup_tree(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            backup_root = Path(temp_dir) / "AMR01" / "run"
            local_file = backup_root / "home/matrix/node-red-dev/node-red-user/flows.json"
            local_file.parent.mkdir(parents=True)
            local_file.write_text("{}")
            (backup_root / ".auto_backup_manifest.json").write_text("{}")
            backup_file = models.BackupFile(
                backup_file_id=1,
                backup_id=1,
                file_name="flows.json",
                file_path=str(local_file),
                file_type="json",
                file_size_mb=0,
                checksum="flows",
                file_status=constants.BACKUP_STATUS_SUCCESS,
                created_at=now_local(),
            )
            manifest = {
                "paths": {
                    "/home/matrix/node-red-dev/node-red-user/flows.json": {
                        "remote_path": "/home/matrix/node-red-dev/node-red-user/flows.json",
                    },
                    "/etc/udev/rules.d/matrix_robot.rules": {
                        "remote_path": "/etc/udev/rules.d/matrix_robot.rules",
                    },
                }
            }

            self.assertEqual(
                _backup_file_remote_path(backup_file, manifest),
                "/home/matrix/node-red-dev/node-red-user/flows.json",
            )

    def test_zip_backup_file_uses_single_manifest_remote_path(self):
        backup_file = models.BackupFile(
            backup_file_id=1,
            backup_id=1,
            file_name="maps.zip",
            file_path="/tmp/maps.zip",
            file_type="zip",
            file_size_mb=1,
            checksum="zip",
            file_status=constants.BACKUP_STATUS_SUCCESS,
            created_at=now_local(),
        )
        manifest = {
            "paths": {
                "/home/matrix/maps": {
                    "remote_path": "/home/matrix/maps",
                    "checksum": "abc",
                }
            }
        }

        self.assertEqual(
            _backup_file_remote_path(backup_file, manifest),
            "/home/matrix/maps",
        )

    def test_manifest_checksum_controls_auto_backup_change_detection(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            remote_path = "/home/matrix/node-red-dev/node-red-user/flows.json"
            snapshot = RemotePathSnapshot(
                remote_path=remote_path,
                is_directory=False,
                size_bytes=12,
                modified_at=now_local(),
                checksum="checksum-1",
            )
            manifest = _build_auto_backup_manifest([(remote_path, snapshot, False)], None)
            manifest_path = _write_auto_backup_manifest(root, manifest)

            backup = models.Backup(
                backup_id=1,
                device_id=1,
                backup_name="auto",
                backup_type=constants.BACKUP_TYPE_AUTO,
                backup_status=constants.BACKUP_STATUS_SUCCESS,
                total_file=1,
                total_size_mb=0,
                created_by=1,
                created_at=now_local() - timedelta(hours=1),
                updated_at=now_local(),
            )
            backup.files = [
                models.BackupFile(
                    backup_file_id=1,
                    backup_id=1,
                    file_name=manifest_path.name,
                    file_path=str(manifest_path),
                    file_type="json",
                    file_size_mb=0,
                    checksum="manifest",
                    file_status=constants.BACKUP_STATUS_SUCCESS,
                    created_at=now_local(),
                )
            ]

            self.assertFalse(_remote_snapshot_changed(snapshot, backup, remote_path))

            changed_snapshot = RemotePathSnapshot(
                remote_path=remote_path,
                is_directory=False,
                size_bytes=12,
                modified_at=now_local(),
                checksum="checksum-2",
            )
            self.assertTrue(_remote_snapshot_changed(changed_snapshot, backup, remote_path))

    def test_change_detection_uses_older_backup_manifest_when_latest_is_partial(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            remote_path = "/home/matrix/public_web/ist_web_release/writable/uploads/maps"
            snapshot = RemotePathSnapshot(
                remote_path=remote_path,
                is_directory=True,
                size_bytes=120,
                modified_at=now_local(),
                checksum="maps-checksum",
            )
            old_manifest = _build_auto_backup_manifest([(remote_path, snapshot, False)], None)
            old_manifest_path = _write_auto_backup_manifest(root / "old", old_manifest)
            partial_manifest_path = _write_auto_backup_manifest(
                root / "latest",
                _build_auto_backup_manifest(
                    [
                        (
                            "/home/matrix/node-red-dev/node-red-user/flows.json",
                            RemotePathSnapshot(
                                remote_path="/home/matrix/node-red-dev/node-red-user/flows.json",
                                is_directory=False,
                                size_bytes=12,
                                modified_at=now_local(),
                                checksum="flows-checksum",
                            ),
                            False,
                        )
                    ],
                    None,
                ),
            )
            old_backup = models.Backup(
                backup_id=1,
                device_id=1,
                backup_name="old-auto",
                backup_type=constants.BACKUP_TYPE_AUTO,
                backup_status=constants.BACKUP_STATUS_SUCCESS,
                total_file=1,
                total_size_mb=0,
                created_by=1,
                created_at=now_local() - timedelta(hours=2),
                updated_at=now_local(),
            )
            old_backup.files = [
                models.BackupFile(
                    backup_file_id=1,
                    backup_id=1,
                    file_name=old_manifest_path.name,
                    file_path=str(old_manifest_path),
                    file_type="json",
                    file_size_mb=0,
                    checksum="manifest",
                    file_status=constants.BACKUP_STATUS_SUCCESS,
                    created_at=now_local(),
                )
            ]
            latest_partial_backup = models.Backup(
                backup_id=2,
                device_id=1,
                backup_name="latest-partial-auto",
                backup_type=constants.BACKUP_TYPE_AUTO,
                backup_status=constants.BACKUP_STATUS_SUCCESS,
                total_file=1,
                total_size_mb=0,
                created_by=1,
                created_at=now_local() - timedelta(hours=1),
                updated_at=now_local(),
            )
            latest_partial_backup.files = [
                models.BackupFile(
                    backup_file_id=2,
                    backup_id=2,
                    file_name=partial_manifest_path.name,
                    file_path=str(partial_manifest_path),
                    file_type="json",
                    file_size_mb=0,
                    checksum="manifest",
                    file_status=constants.BACKUP_STATUS_SUCCESS,
                    created_at=now_local(),
                )
            ]

            self.assertFalse(
                _remote_snapshot_changed(
                    snapshot,
                    [latest_partial_backup, old_backup],
                    remote_path,
                )
            )

    def test_full_baseline_interval_uses_recent_baseline_manifest(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            remote_path = "/home/matrix/node-red-dev/node-red-user/flows.json"
            snapshot = RemotePathSnapshot(
                remote_path=remote_path,
                is_directory=False,
                size_bytes=12,
                modified_at=now_local(),
                checksum="checksum-1",
            )
            manifest = _build_auto_backup_manifest(
                [(remote_path, snapshot, True)],
                None,
                backup_mode="full_baseline",
            )
            manifest_path = _write_auto_backup_manifest(root, manifest)
            baseline = models.Backup(
                backup_id=1,
                device_id=1,
                backup_name="auto-baseline",
                backup_type=constants.BACKUP_TYPE_AUTO,
                backup_status=constants.BACKUP_STATUS_SUCCESS,
                total_file=1,
                total_size_mb=0,
                created_by=1,
                created_at=now_local() - timedelta(days=7),
                updated_at=now_local(),
            )
            baseline.files = [
                models.BackupFile(
                    backup_file_id=1,
                    backup_id=1,
                    file_name=manifest_path.name,
                    file_path=str(manifest_path),
                    file_type="json",
                    file_size_mb=0,
                    checksum="manifest",
                    file_status=constants.BACKUP_STATUS_SUCCESS,
                    created_at=now_local(),
                )
            ]
            device = models.Device(
                device_id=1,
                group_id=1,
                device_code="AMR01",
                device_name="AMR01",
                ip_address="172.30.39.101",
                device_status=constants.DEVICE_STATUS_ONLINE,
                created_at=now_local(),
                updated_at=now_local(),
            )

            self.assertFalse(
                _should_create_full_baseline(
                    recent_backups=[baseline],
                    device=device,
                    remote_paths=[remote_path],
                    interval_days=30,
                    forced=False,
                )
            )

    def test_row_reference_names_are_resolved_from_related_ids(self):
        rows = [
            {"backup_id": 5, "device_id": 9, "group_id": 2},
            {"backup_id": 6, "device_id": 10, "group_id": 3},
        ]
        lookup = {
            "backup_id": {5: "auto-backup-1", 6: "auto-backup-2"},
            "device_id": {9: "AMR01", 10: "AMR02"},
            "group_id": {2: "AMR", 3: "SMR"},
        }

        resolved = _resolve_row_reference_names(rows, lookup)

        self.assertEqual(resolved[0]["backup_name"], "auto-backup-1")
        self.assertEqual(resolved[0]["device_name"], "AMR01")
        self.assertEqual(resolved[0]["group_name"], "AMR")
        self.assertEqual(resolved[1]["backup_name"], "auto-backup-2")
        self.assertEqual(resolved[1]["device_name"], "AMR02")
        self.assertEqual(resolved[1]["group_name"], "SMR")

    def test_database_checksum_ignores_row_order(self):
        rows = [
            {"id": 2, "name": "B"},
            {"id": 1, "name": "A"},
        ]
        same_rows_different_order = [
            {"id": 1, "name": "A"},
            {"id": 2, "name": "B"},
        ]

        self.assertEqual(
            _database_payload_checksum("istuvd", "ros_maps", rows),
            _database_payload_checksum("istuvd", "ros_maps", same_rows_different_order),
        )

    def test_database_change_detection_accepts_legacy_manifest_when_rows_match(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            old_dump_path = root / "istuvd_ros_maps.json"
            old_dump_path.write_text(
                '{"database":"istuvd","table":"ros_maps","dumped_at":"old","rows":[{"id":2,"name":"B"},{"id":1,"name":"A"}]}',
                encoding="utf-8",
            )
            backup = models.Backup(
                backup_id=1,
                device_id=1,
                backup_name="auto",
                backup_type=constants.BACKUP_TYPE_AUTO,
                backup_status=constants.BACKUP_STATUS_SUCCESS,
                total_file=1,
                total_size_mb=0,
                created_by=1,
                created_at=now_local() - timedelta(hours=1),
                updated_at=now_local(),
            )
            backup.files = [
                models.BackupFile(
                    backup_file_id=1,
                    backup_id=1,
                    file_name="istuvd_ros_maps.json",
                    file_path=str(old_dump_path),
                    file_type="json",
                    file_size_mb=0,
                    checksum="legacy-file-checksum",
                    file_status=constants.BACKUP_STATUS_SUCCESS,
                    created_at=now_local(),
                )
            ]
            manifest = {
                "paths": {
                    "ssh+mysql://172.30.39.101:3306/istuvd/ros_maps": {
                        "remote_path": "ssh+mysql://172.30.39.101:3306/istuvd/ros_maps",
                        "checksum": "legacy-manifest-checksum",
                    }
                }
            }
            _write_auto_backup_manifest(root, manifest)
            new_checksum = _database_payload_checksum(
                "istuvd",
                "ros_maps",
                [{"id": 1, "name": "A"}, {"id": 2, "name": "B"}],
            )
            database_dump = DownloadedFile(
                file_name="istuvd_ros_maps.json",
                local_path=str(root / "new.json"),
                remote_path="ssh+mysql://172.30.39.101:3306/istuvd/ros_maps",
                file_size_mb=0,
                checksum=new_checksum,
            )

            self.assertFalse(_database_dump_changed(database_dump, backup))


if __name__ == "__main__":
    unittest.main()
