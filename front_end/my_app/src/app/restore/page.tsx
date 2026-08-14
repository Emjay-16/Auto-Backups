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
  const [fallbackTargetPath, setFallbackTargetPath] = useState("");
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
    () => {
      const pageCount = Math.max(1, Math.ceil(backups.length / BACKUP_PAGE_SIZE));
      const safePage = Math.min(backupPage, pageCount - 1);
      return backups.slice(safePage * BACKUP_PAGE_SIZE, safePage * BACKUP_PAGE_SIZE + BACKUP_PAGE_SIZE);
    },
    [backups, backupPage],
  );
  const backupPageCount = Math.max(1, Math.ceil(backups.length / BACKUP_PAGE_SIZE));
  const safeBackupPage = Math.min(backupPage, backupPageCount - 1);
  const selectedFileCount = selectedFileIds.length;
  const totalBackupFiles = backupDetail?.files.length ?? 0;
  const allFilesSelected = totalBackupFiles > 0 && selectedFileCount === totalBackupFiles;
  const sourceReady = restoreMode === "upload" ? uploadFiles.length > 0 : Boolean(selectedBackup);
  const filesReady = restoreMode === "upload" ? uploadFiles.length > 0 : selectedFileCount > 0;
  const targetReady = restoreMode === "upload" ? Boolean(selectedDeviceId && fallbackTargetPath.trim()) : Boolean(selectedBackup);

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
      target_path: (targetPaths[backupFileId] || fallbackTargetPath).trim(),
    }));
    const selectedFiles = backupDetail.files.filter((file) => selectedFileIds.includes(file.backup_file_id));
    const missingTargetFile = selectedFiles.find((file) => !isLikelyDatabaseBackupFile(file) && !items.find((item) => item.backup_file_id === file.backup_file_id)?.target_path);
    if (missingTargetFile) {
      setError(`Please enter restore target path for ${missingTargetFile.file_name}.`);
      return;
    }

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
    if (!fallbackTargetPath.trim()) {
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
        target_path: fallbackTargetPath.trim(),
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
      <div className={styles.restoreBoard}>
        <main className={styles.restoreWorkspace}>
          <section className={styles.restoreHeader}>
            <div>
              <p>Restore Operation</p>
              <h2>{restoreMode === "upload" ? "Upload files to a robot" : "Restore files from backup history"}</h2>
            </div>
            <div className={styles.modeSwitch} aria-label="Restore mode">
              <button className={restoreMode !== "upload" ? styles.activeMode : ""} onClick={() => setRestoreMode("overwrite")} type="button">
                From backup
              </button>
              <button className={restoreMode === "upload" ? styles.activeMode : ""} onClick={() => setRestoreMode("upload")} type="button">
                Upload
              </button>
            </div>
          </section>

          <section className={styles.restoreGrid}>
            <Panel title={restoreMode === "upload" ? "Upload Source" : "Backup Library"}>
              {restoreMode === "upload" ? (
                <div className={styles.uploadSource}>
                  <label className={styles.uploadDropzone}>
                    <strong>Choose local files</strong>
                    <span>{uploadFiles.length ? `${uploadFiles.length} file(s) ready` : "Select files from this computer"}</span>
                    <input multiple type="file" onChange={(event) => setUploadFiles(Array.from(event.target.files ?? []))} />
                  </label>
                  {uploadFiles.length ? (
                    <div className={styles.uploadList}>
                      {uploadFiles.map((file) => (
                        <span key={`${file.name}-${file.size}-${file.lastModified}`}>{file.name}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className={styles.libraryHeader}>
                    <div>
                      <strong>{backups.length}</strong>
                      <span>available restore point(s)</span>
                    </div>
                    <b>{selectedBackup ? selectedBackup.device : "Select one"}</b>
                  </div>
                  <div className={styles.snapshots}>
                    {visibleBackups.length ? visibleBackups.map((backup, index) => (
                      <button
                        className={`${styles.snapshot} ${String(backup.id) === selectedBackupId ? styles.selected : ""}`}
                        key={backup.id ?? `${backup.device}-${backup.name}-${backup.createdAtRaw ?? backup.createdAt}-${index}`}
                        onClick={() => {
                          setSelectedBackupId(String(backup.id ?? ""));
                          setFilesDialogOpen(false);
                        }}
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className={`${styles.selectionCheck} ${String(backup.id) === selectedBackupId ? styles.checked : ""}`}
                        />
                        <div>
                          <strong>{backup.name}</strong>
                          <p>{backup.device} · {backup.files} file(s) · {backup.size}</p>
                        </div>
                        <b>{backup.type}</b>
                      </button>
                    )) : (
                      <p className={styles.empty}>No backups available.</p>
                    )}
                  </div>
                  <PaginationControls
                    page={safeBackupPage}
                    pageSize={BACKUP_PAGE_SIZE}
                    total={backups.length}
                    onPrevious={() => setBackupPage((current) => Math.max(0, Math.min(current, backupPageCount - 1) - 1))}
                    onNext={() => setBackupPage((current) => Math.min(backupPageCount - 1, current + 1))}
                  />
                </>
              )}
            </Panel>

            <Panel title="Restore Setup">
              <div className={styles.target}>
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
                      <input value={fallbackTargetPath} onChange={(event) => setFallbackTargetPath(event.target.value)} placeholder="/remote/path/on/robot" />
                    </label>
                  </>
                ) : (
                  <>
                    <div className={styles.selectedBackupCard}>
                      <span>Selected backup</span>
                      <strong>{selectedBackup?.name ?? "Choose a backup"}</strong>
                      <small>{selectedBackup ? `${selectedBackup.device} · ${selectedBackup.files} file(s) · ${selectedBackup.size}` : "Select from Backup Library"}</small>
                    </div>
                    <div className={styles.lockedTargetCard}>
                      <span>Destination device</span>
                      <strong>{selectedBackup?.device ?? "Locked to backup owner"}</strong>
                    </div>
                    <label>
                      Default target path (optional)
                      <input value={fallbackTargetPath} onChange={(event) => setFallbackTargetPath(event.target.value)} placeholder="ใช้เมื่อไฟล์ใน popup ไม่ได้กำหนด Restore to" />
                      <span className={styles.hint}>ถ้าต้องการส่งไฟล์ไป path อื่น ให้แก้ช่อง Restore to ใน popup ของไฟล์นั้น ช่องนี้ใช้เฉพาะไฟล์ที่ไม่มี path แยกเท่านั้น</span>
                    </label>
                    <div className={styles.filePickerSummary}>
                      <div>
                        <strong>{selectedFileCount} / {totalBackupFiles}</strong>
                        <span>files selected</span>
                      </div>
                      <button type="button" disabled={!backupDetail || saving} onClick={() => setFilesDialogOpen(true)}>
                        Manage files
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
                <button className={styles.primaryAction} onClick={restoreMode === "upload" ? submitUpload : submitRestore} disabled={saving || !sourceReady || !targetReady || !filesReady} type="button">
                  {restoreMode === "upload" ? (saving ? "Uploading..." : "Upload to robot") : (saving ? "Restoring..." : "Restore selected")}
                </button>
              </div>
            </Panel>
          </section>

        </main>
      </div>

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
              <div>
                <button type="button" onClick={selectAllFiles} disabled={!backupDetail || allFilesSelected}>
                  Select all
                </button>
                <button type="button" onClick={clearFileSelection} disabled={!selectedFileCount}>
                  Clear
                </button>
              </div>
              <span>{selectedFileCount} selected</span>
            </div>

            <div className={styles.files}>
              {backupDetail ? (
                <>
                  {backupDetail.files.map((file) => {
                    const isDatabase = isLikelyDatabaseBackupFile(file);
                    const isZip = isZipBackupFile(file);
                    return (
                      <article
                        className={`${styles.fileRow} ${selectedFileIds.includes(file.backup_file_id) ? styles.selectedFile : ""}`}
                        key={file.backup_file_id}
                      >
                        <label>
                          <input
                            checked={selectedFileIds.includes(file.backup_file_id)}
                            onChange={() => toggleFile(file.backup_file_id)}
                            type="checkbox"
                          />
                          <span className={styles.fileMeta}>
                            <span className={styles.fileTitleLine}>
                              <strong>{file.file_name}</strong>
                              <b className={`${styles.fileTypeBadge} ${isDatabase ? styles.databaseBadge : ""} ${isZip ? styles.zipBadge : ""}`}>
                                {restoreFileKindLabel(file)}
                              </b>
                            </span>
                            <small>{Number(file.file_size_mb).toFixed(2)} MB · {file.file_type}</small>
                          </span>
                        </label>
                        {isDatabase ? (
                          <div className={`${styles.targetPathField} ${styles.databaseTarget}`}>
                            <span>Database restore</span>
                            <p>ใช้ค่า MySQL ของหุ่นตัวนี้ ไม่ต้องใส่ path ไฟล์</p>
                          </div>
                        ) : (
                          <div className={styles.targetPathField}>
                            <span>{isZip ? "Target folder" : "Restore to"}</span>
                            <input
                              value={targetPaths[file.backup_file_id] ?? fallbackTargetPath}
                              onChange={(event) => setTargetPaths({ ...targetPaths, [file.backup_file_id]: event.target.value })}
                              placeholder={isZip ? "/remote/folder/on/robot" : "Path ปลายทางของไฟล์นี้"}
                            />
                            {isZip ? <p>ถ้า zip มีหลายไฟล์ ต้องใส่ path เป็นโฟลเดอร์ปลายทาง</p> : null}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </>
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
  if (isLikelyDatabaseBackupFile(file)) return "";
  if (file.remote_path) return file.remote_path;
  if (file.file_name === "flows.json") return "/home/matrix/node-red-dev/node-red-user/flows.json";
  const mapsRoot = "/home/matrix/public_web/ist_web_release/writable/uploads/maps";
  if (isZipBackupFile(file) && file.file_name.toLowerCase().includes("maps")) return mapsRoot;
  if (isZipBackupFile(file)) return "";
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

function isLikelyDatabaseBackupFile(file: BackupFileDetail): boolean {
  const name = file.file_name.toLowerCase();
  return name.endsWith(".json") && (name.includes("ros_maps") || name.includes("istuvd_ros_maps"));
}

function isZipBackupFile(file: BackupFileDetail): boolean {
  return file.file_name.toLowerCase().endsWith(".zip") || file.file_type.toLowerCase() === "zip";
}

function restoreFileKindLabel(file: BackupFileDetail): string {
  if (isLikelyDatabaseBackupFile(file)) return "database";
  if (isZipBackupFile(file)) return "zip";
  return "file";
}

function getErrorMessage(errorResponse: unknown, fallback: string): string {
  return errorResponse instanceof Error ? errorResponse.message : fallback;
}
