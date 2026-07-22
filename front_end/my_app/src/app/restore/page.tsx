"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/Panel";
import { PaginationControls } from "@/components/PaginationControls";
import { useToast } from "@/components/ToastProvider";
import {
  getBackupDetail,
  getBackupsForUi,
  getDevicesForUi,
  restoreBackup,
  uploadFilesToDevice,
  type BackupDetail,
  type BackupFileDetail,
  type RestoreRunResult,
  type UploadRunResult,
} from "@/lib/api";
import type { Backup, Device } from "@/lib/types";
import styles from "@/styles/pages/restore/restore.module.css";

const BACKUP_PAGE_SIZE = 6;

export default function RestorePage() {
  const { showToast } = useToast();
  const [restoreMode, setRestoreMode] = useState("overwrite");
  const [backups, setBackups] = useState<Backup[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedBackupId, setSelectedBackupId] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [backupDetail, setBackupDetail] = useState<BackupDetail | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [targetPaths, setTargetPaths] = useState<Record<number, string>>({});
  const [defaultTargetPath, setDefaultTargetPath] = useState("/home/matrix/node-red-dev/node-red-user/flows.json");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [result, setResult] = useState<RestoreRunResult | UploadRunResult | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [backupPage, setBackupPage] = useState(0);
  const [filesDialogOpen, setFilesDialogOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([getBackupsForUi(), getDevicesForUi()]).then(([backupItems, deviceItems]) => {
      if (!mounted) return;
      setBackups(backupItems.filter((backup) => backup.id));
      setDevices(deviceItems);

      const params = new URLSearchParams(window.location.search);
      const backupId = params.get("backup_id") ?? String(backupItems.find((backup) => backup.id)?.id ?? "");
      const deviceId = params.get("device_id") ?? String(deviceItems.find((device) => device.id)?.id ?? "");
      setSelectedBackupId(backupId);
      setSelectedDeviceId(deviceId);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const backupId = Number(selectedBackupId);
    if (!backupId || restoreMode === "upload") {
      const resetId = window.setTimeout(() => {
        setBackupDetail(null);
        setSelectedFileIds([]);
      }, 0);
      return () => window.clearTimeout(resetId);
    }

    let mounted = true;
    const loadingId = window.setTimeout(() => {
      if (!mounted) return;
      setSaving(true);
      setError("");
    }, 0);
    getBackupDetail(backupId)
      .then((detail) => {
        if (!mounted) return;
        setBackupDetail(detail);
        setSelectedFileIds(detail.files.map((file) => file.backup_file_id));
        setTargetPaths(
          Object.fromEntries(detail.files.map((file) => [file.backup_file_id, inferRestoreTarget(file)])),
        );
      })
      .catch((errorResponse) => {
        if (mounted) {
          showToast({ tone: "error", title: "Load backup detail failed", message: getErrorMessage(errorResponse, "Load backup detail failed") });
        }
      })
      .finally(() => {
        if (mounted) setSaving(false);
      });

    return () => {
      mounted = false;
      window.clearTimeout(loadingId);
    };
  }, [selectedBackupId, restoreMode, showToast]);

  const selectedBackup = useMemo(
    () => backups.find((backup) => String(backup.id) === selectedBackupId),
    [backups, selectedBackupId],
  );
  const visibleBackups = useMemo(
    () => backups.slice(backupPage * BACKUP_PAGE_SIZE, backupPage * BACKUP_PAGE_SIZE + BACKUP_PAGE_SIZE),
    [backups, backupPage],
  );
  const selectedFileCount = selectedFileIds.length;
  const totalBackupFiles = backupDetail?.files.length ?? 0;
  const allFilesSelected = totalBackupFiles > 0 && selectedFileCount === totalBackupFiles;

  async function submitRestore() {
    const backupId = Number(selectedBackupId);
    if (!backupId || !backupDetail) {
      setError("Please select a backup.");
      return;
    }
    if (!selectedFileIds.length) {
      setError("Please select at least one backup file.");
      return;
    }

    const items = selectedFileIds.map((backupFileId) => ({
      backup_file_id: backupFileId,
      target_path: targetPaths[backupFileId] || defaultTargetPath,
    }));

    setSaving(true);
    setError("");
    setResult(null);
    try {
      const response = await restoreBackup(backupId, {
        restored_by: 1,
        restore_type: 1,
        items,
      });
      setResult(response);
      showToast({
        tone: "success",
        title: "Restore completed",
        message: `${response.total_file} file(s) restored`,
      });
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Restore failed", message: getErrorMessage(errorResponse, "Restore failed") });
    } finally {
      setSaving(false);
    }
  }

  async function submitUpload() {
    const deviceId = Number(selectedDeviceId);
    if (!deviceId) {
      setError("Please select a device from API data.");
      return;
    }
    if (!defaultTargetPath.trim()) {
      setError("Please enter target path.");
      return;
    }
    if (!uploadFiles.length) {
      setError("Please choose at least one file.");
      return;
    }

    setSaving(true);
    setError("");
    setResult(null);
    try {
      const response = await uploadFilesToDevice({
        device_id: deviceId,
        target_path: defaultTargetPath.trim(),
        files: uploadFiles,
      });
      setResult(response);
      showToast({
        tone: "success",
        title: "Upload completed",
        message: `${response.total_file} file(s) uploaded to ${response.device_name}`,
      });
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Upload failed", message: getErrorMessage(errorResponse, "Upload failed") });
    } finally {
      setSaving(false);
    }
  }

  function toggleFile(fileId: number) {
    setSelectedFileIds((current) => (
      current.includes(fileId)
        ? current.filter((item) => item !== fileId)
        : [...current, fileId]
    ));
  }

  function selectAllFiles() {
    if (!backupDetail) return;
    setSelectedFileIds(backupDetail.files.map((file) => file.backup_file_id));
  }

  function clearFileSelection() {
    setSelectedFileIds([]);
  }

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <Panel title="Restore Candidates">
          <div className={styles.snapshots}>
            {visibleBackups.map((backup) => (
              <button
                className={`${styles.snapshot} ${String(backup.id) === selectedBackupId ? styles.selected : ""}`}
                disabled={restoreMode === "upload"}
                key={backup.id ?? backup.name}
                onClick={() => {
                  setSelectedBackupId(String(backup.id ?? ""));
                  setFilesDialogOpen(false);
                }}
              >
                <span className={styles.radio} />
                <div>
                  <strong>{backup.name}</strong>
                  <p>{backup.device} · {backup.files} file(s) · {backup.size}</p>
                </div>
                <b>{backup.type}</b>
              </button>
            ))}
          </div>
          <PaginationControls
            page={backupPage}
            pageSize={BACKUP_PAGE_SIZE}
            total={backups.length}
            onPrevious={() => setBackupPage((current) => Math.max(0, current - 1))}
            onNext={() => setBackupPage((current) => Math.min(Math.ceil(backups.length / BACKUP_PAGE_SIZE) - 1, current + 1))}
          />
        </Panel>

        <Panel title="Restore Target">
          <div className={styles.target}>
            <label>
              Restore mode
              <select value={restoreMode} onChange={(event) => setRestoreMode(event.target.value)}>
                <option value="overwrite">Restore from backup</option>
                <option value="upload">Upload file</option>
              </select>
            </label>

            {restoreMode === "upload" ? (
              <>
                <label>
                  Device
                  <select value={selectedDeviceId} onChange={(event) => setSelectedDeviceId(event.target.value)}>
                    {devices.filter((device) => device.id).map((device) => (
                      <option key={`${device.id}-${device.name}`} value={device.id}>
                        {device.name} · {device.ip}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Target path
                  <input value={defaultTargetPath} onChange={(event) => setDefaultTargetPath(event.target.value)} />
                </label>
                <label className={styles.uploadField}>
                  Upload file
                  <input multiple type="file" onChange={(event) => setUploadFiles(Array.from(event.target.files ?? []))} />
                  <span>ไฟล์นี้จะถูกอัพโหลดไปยัง target path ที่เลือกไว้</span>
                </label>
              </>
            ) : (
              <>
                <label>
                  Selected backup
                  <select value={selectedBackupId} onChange={(event) => setSelectedBackupId(event.target.value)}>
                    {backups.map((backup) => (
                      <option key={backup.id ?? backup.name} value={backup.id}>
                        {backup.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Default target path
                  <input value={defaultTargetPath} onChange={(event) => setDefaultTargetPath(event.target.value)} />
                </label>
                <div className={styles.filePickerSummary}>
                  <div>
                    <strong>{selectedFileCount} / {totalBackupFiles}</strong>
                    <span>files selected</span>
                  </div>
                  <button type="button" disabled={!backupDetail || saving} onClick={() => setFilesDialogOpen(true)}>
                    Choose files
                  </button>
                </div>
              </>
            )}

            {error ? <p className={styles.error}>{error}</p> : null}
            {result ? (
              <p className={styles.success}>
                {result.message} · {"total_file" in result ? result.total_file : 0} file(s)
              </p>
            ) : null}
            <button onClick={restoreMode === "upload" ? submitUpload : submitRestore} disabled={saving}>
              {restoreMode === "upload" ? (saving ? "Uploading..." : "Upload to robot") : (saving ? "Restoring..." : "Restore selected")}
            </button>
          </div>
        </Panel>
      </div>

      <Panel title="Restore Preview">
        <div className={styles.preview}>
          <p><span className={styles.ok}>✓</span>{selectedBackup ? `${selectedBackup.name} selected.` : "Choose a backup from real backup history."}</p>
          <p>
            <span className={allFilesSelected ? styles.ok : styles.warn}>{allFilesSelected ? "✓" : "!"}</span>
            {restoreMode === "upload" ? "Upload mode uses local files." : `${selectedFileCount} of ${totalBackupFiles} backup files selected.`}
          </p>
          <p><span className={styles.warn}>◷</span> Target robot will be reached through SSH/SFTP during restore.</p>
          <p>
            <span className={styles.warn}>!</span>
            {restoreMode === "upload" ? "Uploaded files will be sent to the selected target path." : "Selected backup files will overwrite target paths."}
          </p>
        </div>
      </Panel>

      {filesDialogOpen && restoreMode !== "upload" ? (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={() => setFilesDialogOpen(false)}>
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="restore-files-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className={styles.dialogHeader}>
              <div>
                <h2 id="restore-files-title">Choose restore files</h2>
                <p>{selectedBackup?.name ?? "Selected backup"} · {selectedFileCount} / {totalBackupFiles} selected</p>
              </div>
              <button type="button" onClick={() => setFilesDialogOpen(false)} aria-label="Close">×</button>
            </header>

            <div className={styles.dialogActions}>
              <button type="button" onClick={selectAllFiles} disabled={!backupDetail || allFilesSelected}>
                Select all
              </button>
              <button type="button" onClick={clearFileSelection} disabled={!selectedFileCount}>
                Clear
              </button>
            </div>

            <div className={styles.files}>
              {backupDetail ? (
                backupDetail.files.map((file) => (
                  <article className={styles.fileRow} key={file.backup_file_id}>
                    <label>
                      <input
                        checked={selectedFileIds.includes(file.backup_file_id)}
                        onChange={() => toggleFile(file.backup_file_id)}
                        type="checkbox"
                      />
                      <span>
                        <strong>{file.file_name}</strong>
                        <small>{Number(file.file_size_mb).toFixed(2)} MB · {file.file_type}</small>
                      </span>
                    </label>
                    <input
                      value={targetPaths[file.backup_file_id] ?? defaultTargetPath}
                      onChange={(event) => setTargetPaths({ ...targetPaths, [file.backup_file_id]: event.target.value })}
                    />
                  </article>
                ))
              ) : (
                <p className={styles.empty}>{saving ? "Loading backup files..." : "Select a backup to restore."}</p>
              )}
            </div>

            <footer className={styles.dialogFooter}>
              <button type="button" onClick={() => setFilesDialogOpen(false)}>
                Done
              </button>
              <button type="button" onClick={submitRestore} disabled={saving || !selectedFileCount}>
                {saving ? "Restoring..." : "Restore selected"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function inferRestoreTarget(file: BackupFileDetail): string {
  if (file.file_name === "flows.json") return "/home/matrix/node-red-dev/node-red-user/flows.json";
  const mapsRoot = "/home/matrix/public_web/ist_web_release/writable/uploads/maps";
  const mapsMarker = "/maps/";
  const mapsIndex = file.file_path.indexOf(mapsMarker);
  if (mapsIndex >= 0) {
    return `${mapsRoot}/${file.file_path.slice(mapsIndex + mapsMarker.length)}`;
  }
  if (file.file_name.includes("maps")) {
    return mapsRoot;
  }
  return file.file_name;
}

function getErrorMessage(errorResponse: unknown, fallback: string): string {
  return errorResponse instanceof Error ? errorResponse.message : fallback;
}
