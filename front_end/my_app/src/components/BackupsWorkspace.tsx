"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  backupDownloadUrl,
  cleanupBackups,
  getAutoCleanupSettings,
  getBackupDetail,
  listDeviceFiles,
  runCombinedBackup,
  type AutoCleanupSettings,
  type BackupDetail,
  type BackupCleanupResult,
  type BackupRunResult,
  type BackupTarget,
  type RemoteFile,
} from "@/lib/api";
import type { Backup, Device } from "@/lib/types";
import styles from "@/styles/pages/backups/backups.module.css";
import { BackupIcon } from "./ActionIcons";
import { PaginatedBackupsTable } from "./PaginatedBackupsTable";
import { Panel } from "./Panel";
import { useToast } from "./ToastProvider";

type ModalMode = "backup" | "browse" | "cleanup" | "detail" | null;

export function BackupsWorkspace({
  backups,
  devices,
  targets,
}: {
  backups: Backup[];
  devices: Device[];
  targets: BackupTarget[];
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const usableDevices = devices.filter((device) => device.id);
  const [mode, setMode] = useState<ModalMode>(null);
  const [deviceId, setDeviceId] = useState(String(usableDevices[0]?.id ?? ""));
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [includeDatabase, setIncludeDatabase] = useState(false);
  const [zipOutput, setZipOutput] = useState(false);
  const [browsePath, setBrowsePath] = useState(targets.find((target) => target.browsable)?.path ?? targets[0]?.path ?? "");
  const [remoteFiles, setRemoteFiles] = useState<RemoteFile[]>([]);
  const [openedPath, setOpenedPath] = useState("");
  const [backupDetail, setBackupDetail] = useState<BackupDetail | null>(null);
  const [cleanupDays, setCleanupDays] = useState("90");
  const [cleanupDryRun, setCleanupDryRun] = useState(true);
  const [cleanupKeepLatest, setCleanupKeepLatest] = useState(true);
  const [cleanupSettings, setCleanupSettings] = useState<AutoCleanupSettings | null>(null);
  const [result, setResult] = useState<BackupRunResult | BackupCleanupResult | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDeleteBackup, setPendingDeleteBackup] = useState<Backup | null>(null);

  useEffect(() => {
    let mounted = true;
    getAutoCleanupSettings()
      .then((settings) => {
        if (!mounted) return;
        setCleanupSettings(settings);
        setCleanupDays(String(settings.older_than_days));
        setCleanupKeepLatest(settings.keep_latest_per_device);
      })
      .catch(() => {
        if (mounted) setCleanupSettings(null);
      });

    return () => {
      mounted = false;
    };
  }, []);

  function openModal(nextMode: ModalMode) {
    setMode(nextMode);
    setResult(null);
    setError("");
  }

  function openBackupModal(databaseOnly = false) {
    setSelectedPaths([]);
    setIncludeDatabase(databaseOnly);
    setZipOutput(false);
    setRemoteFiles([]);
    setOpenedPath("");
    openModal("backup");
  }

  function closeModal() {
    if (saving) return;
    setMode(null);
    setResult(null);
    setError("");
  }

  async function submitBackup(databaseOnly = false) {
    const numericDeviceId = Number(deviceId);
    const remotePaths = databaseOnly ? [] : selectedPaths.filter((path) => path.startsWith("/"));
    const databaseSelected = databaseOnly || includeDatabase;

    if (!numericDeviceId) {
      setError("Please select a device.");
      return;
    }
    if (!remotePaths.length && !databaseSelected) {
      setError("Please select at least one backup target.");
      return;
    }

    setSaving(true);
    setError("");
    setResult(null);
    try {
      const response = await runCombinedBackup({
        device_id: numericDeviceId,
        remote_paths: remotePaths,
        include_database: databaseSelected,
        zip_output: zipOutput,
      });
      setResult(response);
      showToast({
        tone: "success",
        title: "Backup completed",
        message: `${response.backup_name} saved for ${response.device_name}`,
      });
      router.refresh();
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Backup failed", message: getErrorMessage(errorResponse, "Backup failed") });
    } finally {
      setSaving(false);
    }
  }

  async function browseFiles() {
    const numericDeviceId = Number(deviceId);
    if (!numericDeviceId) {
      setError("Please select a device.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const files = await listDeviceFiles(numericDeviceId, browsePath);
      setRemoteFiles(files);
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Browse failed", message: getErrorMessage(errorResponse, "Browse failed") });
    } finally {
      setSaving(false);
    }
  }

  async function openTargetPath(path: string) {
    const numericDeviceId = Number(deviceId);
    if (!numericDeviceId) {
      setError("Please select a device.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const files = await listDeviceFiles(numericDeviceId, path);
      setRemoteFiles(files);
      setOpenedPath(path);
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Open folder failed", message: getErrorMessage(errorResponse, "Open folder failed") });
    } finally {
      setSaving(false);
    }
  }

  async function openBackupDetail(backup: Backup) {
    if (!backup.id) return;
    setMode("detail");
    setBackupDetail(null);
    setResult(null);
    setError("");
    setSaving(true);
    try {
      const detail = await getBackupDetail(backup.id);
      setBackupDetail(detail);
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Load backup detail failed", message: getErrorMessage(errorResponse, "Load backup detail failed") });
    } finally {
      setSaving(false);
    }
  }

  async function submitCleanup() {
    setSaving(true);
    setError("");
    setResult(null);
    try {
      const response = await cleanupBackups({
        older_than_days: Number(cleanupDays) || 90,
        dry_run: cleanupDryRun,
        keep_latest_per_device: cleanupKeepLatest,
      });
      setResult(response);
      showToast({
        tone: cleanupDryRun ? "info" : "success",
        title: cleanupDryRun ? "Cleanup preview ready" : "Cleanup completed",
        message: `${response.deleted} deleted · ${response.skipped} skipped`,
      });
      router.refresh();
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Cleanup failed", message: getErrorMessage(errorResponse, "Cleanup failed") });
    } finally {
      setSaving(false);
    }
  }

  function requestDeleteBackup(backup: Backup) {
    if (!backup.id) return;
    setPendingDeleteBackup(backup);
    setError("");
  }

  async function confirmDeleteBackup() {
    const backup = pendingDeleteBackup;
    if (!backup?.id) return;

    setSaving(true);
    setError("");
    try {
      const { deleteBackup } = await import("@/lib/api");
      await deleteBackup(backup.id);
      setPendingDeleteBackup(null);
      showToast({ tone: "success", title: "Backup deleted", message: backup.name });
      if (backupDetail?.backup_id === backup.id) {
        setBackupDetail(null);
        closeModal();
      }
      router.refresh();
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Delete backup failed", message: getErrorMessage(errorResponse, "Delete backup failed") });
    } finally {
      setSaving(false);
    }
  }

  function togglePath(path: string) {
    setSelectedPaths((current) => {
      if (current.includes(path)) {
        return current.filter((item) => item !== path);
      }

      const parentFolder = findParentFolder(path, current, targets) ?? findOpenedParentFolder(path, openedPath);
      const next = [
        ...(parentFolder ? current.filter((item) => item !== parentFolder) : current),
        path,
      ];

      if (!openedPath || !remoteFiles.length) {
        return uniquePaths(next);
      }

      const visiblePaths = remoteFiles.map((file) => file.path);
      const allVisibleSelected = visiblePaths.every((visiblePath) => next.includes(visiblePath));
      if (!allVisibleSelected) {
        return uniquePaths(next);
      }

      return uniquePaths([
        ...next.filter((item) => !visiblePaths.includes(item)),
        openedPath,
      ]);
    });
  }

  return (
    <div className={styles.page}>
      <section className={styles.toolbar}>
        <button className={styles.primary} onClick={() => openBackupModal()}>
          <BackupIcon />
          New backup
        </button>
        <button onClick={() => openModal("browse")}>Browse robot files</button>
        <button onClick={() => openModal("cleanup")}>Cleanup old backups</button>
      </section>

      {error ? <p className={styles.pageError}>{error}</p> : null}

      <Panel title="Backup History">
        <PaginatedBackupsTable
          backups={backups}
          onDelete={requestDeleteBackup}
          onDownload={(backup) => backup.id && window.open(backupDownloadUrl(backup.id), "_blank")}
          onOpen={openBackupDetail}
        />
      </Panel>

      <section className={styles.cards}>
        <Panel title="Selected Paths">
          <div className={styles.pathList}>
            {targets.map((target) => <p key={target.key}>{target.label}: {target.path}</p>)}
          </div>
        </Panel>
        <Panel title="Auto Backup Rule">
          <div className={styles.rule}>
            <strong>Weekly + changed only</strong>
            <span>Compare remote mtime and SHA-256 hash. Offline devices become pending jobs.</span>
          </div>
        </Panel>
        <Panel title="Auto Cleanup Rule">
          <div className={styles.rule}>
            <strong>
              {cleanupSettings
                ? `${cleanupSettings.enabled ? "Enabled" : "Disabled"} · older than ${cleanupSettings.older_than_days} days`
                : "Loading cleanup settings"}
            </strong>
            <span>
              {cleanupSettings
                ? `Runs every ${cleanupSettings.interval_hours} hour(s). ${cleanupSettings.keep_latest_per_device ? "Keeps latest backup per device." : "Latest backups can be removed."}`
                : "Reading /backups/cleanup/settings from API."}
            </span>
          </div>
        </Panel>
      </section>

      {mode ? (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <button className={styles.backdrop} onClick={closeModal} aria-label="Close" />
          <section className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <p>Backups API</p>
                <h2>{mode === "cleanup" ? "Cleanup old backups" : mode === "browse" ? "Browse robot files" : mode === "detail" ? "Backup detail" : "Run backup"}</h2>
              </div>
              <button className={styles.closeButton} onClick={closeModal}>×</button>
            </div>

            {mode === "detail" ? (
              <div className={styles.detailBody}>
                {backupDetail ? (
                  <>
                    <div className={styles.detailSummary}>
                      <strong>{backupDetail.backup_name}</strong>
                      <span>{backupDetail.device_name ?? `Device #${backupDetail.device_id}`} · {backupDetail.total_file} file(s) · {Number(backupDetail.total_size_mb).toFixed(2)} MB</span>
                    </div>
                    <div className={styles.fileList}>
                      {backupDetail.files.map((file) => (
                        <button key={file.backup_file_id}>
                          <span>{file.file_name}</span>
                          <b>{Number(file.file_size_mb).toFixed(2)} MB</b>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className={styles.emptyText}>{saving ? "Loading backup detail..." : "No detail loaded"}</p>
                )}
              </div>
            ) : mode === "cleanup" ? (
              <div className={styles.formGrid}>
                <label>
                  Older than days
                  <input value={cleanupDays} onChange={(event) => setCleanupDays(event.target.value)} />
                  {cleanupSettings ? (
                    <span className={styles.fieldHint}>
                      Current auto cleanup setting: {cleanupSettings.older_than_days} day(s)
                    </span>
                  ) : null}
                </label>
                <label className={styles.checkRow}>
                  <input checked={cleanupDryRun} onChange={(event) => setCleanupDryRun(event.target.checked)} type="checkbox" />
                  Dry run
                </label>
                <label className={styles.checkRow}>
                  <input checked={cleanupKeepLatest} onChange={(event) => setCleanupKeepLatest(event.target.checked)} type="checkbox" />
                  Keep latest per device
                </label>
              </div>
            ) : (
              <div className={styles.formGrid}>
                <label>
                  Device
                  <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
                    {usableDevices.map((device) => (
                      <option key={device.id} value={device.id}>{device.name} · {device.ip}</option>
                    ))}
                  </select>
                </label>

                {mode === "browse" ? (
                  <>
                    <label>
                      Path
                      <input value={browsePath} onChange={(event) => setBrowsePath(event.target.value)} />
                    </label>
                    <div className={styles.fileList}>
                      {remoteFiles.map((file) => (
                        <button
                          key={file.path}
                          onClick={() => {
                            if (file.file_type === "directory") setBrowsePath(file.path);
                            else setSelectedPaths((current) => current.includes(file.path) ? current : [...current, file.path]);
                          }}
                        >
                          <span>{file.name}</span>
                          <b>{file.file_type}</b>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.targetList}>
                      {targets.map((target) => (
                        <label key={target.key}>
                          <input
                            checked={target.backup_api === "robot_db" ? includeDatabase : selectedPaths.includes(target.path)}
                            onChange={() => {
                              if (target.backup_api === "robot_db") setIncludeDatabase((current) => !current);
                              else togglePath(target.path);
                            }}
                            type="checkbox"
                          />
                          <span>{target.label}</span>
                          {target.browsable ? (
                            <button
                              onClick={(event) => {
                                event.preventDefault();
                                openTargetPath(target.path);
                              }}
                              type="button"
                            >
                              Open
                            </button>
                          ) : null}
                        </label>
                      ))}
                    </div>
                    {openedPath ? (
                      <div className={styles.browser}>
                        <div className={styles.browserHeader}>
                          <strong>{openedPath}</strong>
                          <button onClick={() => setOpenedPath("")}>Close</button>
                        </div>
                        {remoteFiles.length ? (
                          remoteFiles.map((file) => (
                            <label className={styles.fileRow} key={file.path}>
                              <input
                                checked={selectedPaths.includes(file.path)}
                                onChange={() => togglePath(file.path)}
                                type="checkbox"
                              />
                              <span>{file.name}</span>
                              {file.file_type === "directory" ? (
                                <button
                                  onClick={(event) => {
                                    event.preventDefault();
                                    openTargetPath(file.path);
                                  }}
                                  type="button"
                                >
                                  Open
                                </button>
                              ) : (
                                <b>{formatBytes(file.size_bytes)}</b>
                              )}
                            </label>
                          ))
                        ) : (
                          <p className={styles.emptyText}>{saving ? "Loading files..." : "No files found"}</p>
                        )}
                      </div>
                    ) : null}
                    <label className={styles.checkRow}>
                      <input checked={zipOutput} onChange={(event) => setZipOutput(event.target.checked)} type="checkbox" />
                      Zip output
                    </label>
                  </>
                )}
              </div>
            )}

            {result ? <ResultBox result={result} /> : null}
            {error ? <p className={styles.formError}>{error}</p> : null}

            <div className={styles.modalActions}>
              <button onClick={closeModal}>Close</button>
              {mode === "detail" && backupDetail ? (
                <button
                  className={styles.dangerButton}
                  onClick={() => requestDeleteBackup({
                    id: backupDetail.backup_id,
                    name: backupDetail.backup_name,
                    device: backupDetail.device_name ?? `Device #${backupDetail.device_id}`,
                    type: String(backupDetail.backup_type),
                    files: backupDetail.total_file,
                    size: `${Number(backupDetail.total_size_mb).toFixed(2)} MB`,
                    status: backupDetail.backup_status === 1 ? "success" : backupDetail.backup_status === 2 ? "failed" : "running",
                    createdAt: backupDetail.created_at,
                  })}
                  disabled={saving}
                >
                  Delete
                </button>
              ) : null}
              {mode === "backup" ? <button onClick={() => submitBackup()} disabled={saving}>{saving ? "Running..." : "Run backup"}</button> : null}
              {mode === "browse" ? <button onClick={browseFiles} disabled={saving}>{saving ? "Loading..." : "Load files"}</button> : null}
              {mode === "cleanup" ? <button onClick={submitCleanup} disabled={saving}>{saving ? "Cleaning..." : "Run cleanup"}</button> : null}
            </div>
          </section>
        </div>
      ) : null}

      {pendingDeleteBackup ? (
        <div className={styles.confirmOverlay} role="dialog" aria-modal="true" aria-labelledby="delete-backup-title">
          <button className={styles.confirmBackdrop} onClick={() => !saving && setPendingDeleteBackup(null)} aria-label="Cancel delete" />
          <section className={styles.confirmDialog}>
            <div className={styles.confirmIcon}>!</div>
            <div className={styles.confirmContent}>
              <h2 id="delete-backup-title">ยืนยันการลบข้อมูล</h2>
              <p>
                คุณต้องการลบ {pendingDeleteBackup.name} ของอุปกรณ์ {pendingDeleteBackup.device} ใช่หรือไม่?
                ประวัติบันทึกและไฟล์สำรองทั้งหมดบนเซิร์ฟเวอร์จะถูกลบอย่างถาวร
              </p>
            </div>
            {error ? <p className={styles.formError}>{error}</p> : null}
            <div className={styles.confirmActions}>
              <button onClick={() => setPendingDeleteBackup(null)} disabled={saving}>Cancel</button>
              <button onClick={confirmDeleteBackup} disabled={saving}>
                {saving ? "Deleting..." : "Delete backup"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ResultBox({ result }: { result: BackupRunResult | BackupCleanupResult }) {
  if ("message" in result) {
    return (
      <div className={styles.resultBox}>
        <strong>{result.message}</strong>
        <span>{result.local_path}</span>
      </div>
    );
  }

  return (
    <div className={styles.resultBox}>
      <strong>{result.dry_run ? "Cleanup preview" : "Cleanup completed"}</strong>
      <span>{result.candidates} candidates · {result.deleted} deleted · {result.skipped} skipped</span>
    </div>
  );
}

function getErrorMessage(errorResponse: unknown, fallback: string): string {
  return errorResponse instanceof Error ? errorResponse.message : fallback;
}

function formatBytes(value?: number | null): string {
  if (!value) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function findParentFolder(path: string, selectedPaths: string[], targets: BackupTarget[]): string | null {
  return targets
    .filter((target) => target.backup_api === "file" && target.target_type === "directory")
    .map((target) => target.path.replace(/\/$/, ""))
    .filter((targetPath) => selectedPaths.includes(targetPath))
    .find((targetPath) => path !== targetPath && path.startsWith(`${targetPath}/`)) ?? null;
}

function findOpenedParentFolder(path: string, openedPath: string): string | null {
  const normalizedOpenedPath = openedPath.replace(/\/$/, "");
  if (!normalizedOpenedPath) return null;
  return path !== normalizedOpenedPath && path.startsWith(`${normalizedOpenedPath}/`) ? normalizedOpenedPath : null;
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}
