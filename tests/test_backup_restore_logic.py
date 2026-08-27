import tempfile
import unittest
import zipfile
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

from api import constants, models
from api.routers.restore import (
    _build_file_restore_transfers,
    _extract_restore_zip,
    _resolve_restore_target_path,
)
from api.services.backup_service import (
    _backup_file_remote_path,
    _build_auto_backup_manifest,
    _database_dump_changed,
    _remote_snapshot_changed,
    _should_create_full_baseline,
    _write_auto_backup_manifest,
)
from api.services.robot_database import _database_payload_checksum
from api.services.sftp_backup import DownloadedFile, RemotePathSnapshot
from api.utils.time import now_local


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
