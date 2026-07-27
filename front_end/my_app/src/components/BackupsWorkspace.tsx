"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  backupDownloadUrl,
  cleanupBackups,
  deleteCustomBackupPath,
  getAutoBackupSettings,
  getAutoCleanupSettings,
  getBackupDetail,
  listDeviceFiles,
  runCombinedBackup,
  saveCustomBackupPath,
  updateAutoBackupSettings,
  updateAutoCleanupSettings,
  type AutoBackupSettings,
  type AutoCleanupSettings,
  type BackupDetail,
  type BackupCleanupResult,
  type BackupRunResult,
  type BackupTarget,
  type RemoteFile,
} from "@/lib/api";
import type { Backup, Device } from "@/lib/types";
import styles from "@/styles/pages/backups/backups.module.css";
import { BackupIcon, CleanupIcon, FolderIcon } from "./ActionIcons";
import { PaginatedBackupsTable } from "./PaginatedBackupsTable";
import { Panel } from "./Panel";
import { useToast } from "./ToastProvider";

type ModalMode = "backup" | "browse" | "cleanup" | "autoBackup" | "detail" | null;

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
  const [backupName, setBackupName] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [customPath, setCustomPath] = useState("");
  const [includeDatabase, setIncludeDatabase] = useState(false);
  const [zipOutput, setZipOutput] = useState(false);
  const [browsePath, setBrowsePath] = useState(targets.find((target) => target.browsable)?.path ?? targets[0]?.path ?? "");
  const [remoteFiles, setRemoteFiles] = useState<RemoteFile[]>([]);
  const [openedPath, setOpenedPath] = useState("");
  const [backupDetail, setBackupDetail] = useState<BackupDetail | null>(null);
  const [selectedDownloadFileIds, setSelectedDownloadFileIds] = useState<number[]>([]);
  const [downloadFilename, setDownloadFilename] = useState("");
  const [pendingDownloadConfirm, setPendingDownloadConfirm] = useState(false);
  const [cleanupDays, setCleanupDays] = useState("90");
  const [cleanupEnabled, setCleanupEnabled] = useState(false);
  const [cleanupIntervalHours, setCleanupIntervalHours] = useState("720");
  const [cleanupDryRun, setCleanupDryRun] = useState(true);
  const [cleanupKeepLatest, setCleanupKeepLatest] = useState(true);
  const [cleanupSettings, setCleanupSettings] = useState<AutoCleanupSettings | null>(null);
  const [autoBackupSettings, setAutoBackupSettings] = useState<AutoBackupSettings | null>(null);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [autoBackupIntervalHours, setAutoBackupIntervalHours] = useState("168");
  const [autoBackupZipOutput, setAutoBackupZipOutput] = useState(false);
  const [autoBackupRunOnStartup, setAutoBackupRunOnStartup] = useState(false);
  const [result, setResult] = useState<BackupRunResult | BackupCleanupResult | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDeleteBackup, setPendingDeleteBackup] = useState<Backup | null>(null);
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null);
  const backupSelectionCount = selectedPaths.length + (includeDatabase ? 1 : 0);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      getAutoCleanupSettings().catch(() => null),
      getAutoBackupSettings().catch(() => null),
    ])
      .then(([cleanupRule, backupRule]) => {
        if (!mounted) return;
        setAutoBackupSettings(backupRule);
        if (backupRule) {
          setAutoBackupEnabled(backupRule.enabled);
          setAutoBackupIntervalHours(String(backupRule.interval_hours));
          setAutoBackupZipOutput(backupRule.zip_output);
          setAutoBackupRunOnStartup(backupRule.run_on_startup);
        }
        setCleanupSettings(cleanupRule);
        if (!cleanupRule) return;
        setCleanupDays(String(cleanupRule.older_than_days));
        setCleanupEnabled(cleanupRule.enabled);
        setCleanupIntervalHours(String(cleanupRule.interval_hours));
        setCleanupKeepLatest(cleanupRule.keep_latest_per_device);
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
    setBackupName("");
    setSelectedPaths([]);
    setCustomPath("");
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
        backup_name: backupName.trim() || undefined,
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
    setSelectedDownloadFileIds([]);
    setDownloadFilename("");
    setResult(null);
    setError("");
    setSaving(true);
    try {
      const detail = await getBackupDetail(backup.id);
      setBackupDetail(detail);
      setSelectedDownloadFileIds(detail.files.map((file) => file.backup_file_id));
      setDownloadFilename(`${detail.backup_name}.zip`);
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

  async function saveCleanupSettings() {
    setSaving(true);
    setError("");
    try {
      const settings = await updateAutoCleanupSettings({
        enabled: cleanupEnabled,
        older_than_days: Number(cleanupDays) || 90,
        interval_hours: Number(cleanupIntervalHours) || 720,
        keep_latest_per_device: cleanupKeepLatest,
      });
      setCleanupSettings(settings);
      setCleanupDays(String(settings.older_than_days));
      setCleanupEnabled(settings.enabled);
      setCleanupIntervalHours(String(settings.interval_hours));
      setCleanupKeepLatest(settings.keep_latest_per_device);
      showToast({
        tone: "success",
        title: "Auto cleanup updated",
        message: `${settings.enabled ? "Enabled" : "Disabled"} · older than ${settings.older_than_days} days`,
      });
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Save cleanup settings failed", message: getErrorMessage(errorResponse, "Save cleanup settings failed") });
    } finally {
      setSaving(false);
    }
  }

  async function saveAutoBackupSettings() {
    setSaving(true);
    setError("");
    try {
      const settings = await updateAutoBackupSettings({
        enabled: autoBackupEnabled,
        interval_hours: Number(autoBackupIntervalHours) || 168,
        zip_output: autoBackupZipOutput,
        run_on_startup: autoBackupRunOnStartup,
      });
      setAutoBackupSettings(settings);
      setAutoBackupEnabled(settings.enabled);
      setAutoBackupIntervalHours(String(settings.interval_hours));
      setAutoBackupZipOutput(settings.zip_output);
      setAutoBackupRunOnStartup(settings.run_on_startup);
      showToast({
        tone: "success",
        title: "Auto backup updated",
        message: `${settings.enabled ? "Enabled" : "Disabled"} · every ${settings.interval_hours} hour(s)`,
      });
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Save auto backup settings failed", message: getErrorMessage(errorResponse, "Save auto backup settings failed") });
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
      setSelectedDownloadFileIds([]);
      setPendingDownloadConfirm(false);
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

  function selectAllBackupTargets() {
    setSelectedPaths(uniquePaths(targets
      .filter((target) => target.backup_api !== "robot_db")
      .map((target) => target.path)));
    setIncludeDatabase(targets.some((target) => target.backup_api === "robot_db"));
  }

  function clearBackupTargets() {
    setSelectedPaths([]);
    setIncludeDatabase(false);
  }

  async function addCustomPath() {
    const path = customPath.trim();
    if (!path) return;
    if (!path.startsWith("/")) {
      setError("Custom backup path must start with /");
      return;
    }
    try {
      const savedPath = await saveCustomBackupPath(path);
      setSelectedPaths((current) => uniquePaths([...current, savedPath.path]));
      setCustomPath("");
      setError("");
      showToast({
        tone: "success",
        title: "Auto backup path added",
        message: savedPath.path,
      });
      router.refresh();
    } catch (errorResponse) {
      showToast({
        tone: "error",
        title: "Save auto backup path failed",
        message: getErrorMessage(errorResponse, "Save auto backup path failed"),
      });
    }
  }

  function requestDeleteCustomPath(path: string) {
    setPendingDeletePath(path);
    setError("");
  }

  function toggleDownloadFile(fileId: number) {
    setSelectedDownloadFileIds((current) => (
      current.includes(fileId)
        ? current.filter((selectedId) => selectedId !== fileId)
        : [...current, fileId]
    ));
  }

  function toggleAllDownloadFiles() {
    if (!backupDetail) return;
    const allFileIds = backupDetail.files.map((file) => file.backup_file_id);
    setSelectedDownloadFileIds((current) => (
      current.length === allFileIds.length ? [] : allFileIds
    ));
  }

  function downloadSelectedFiles() {
    if (!backupDetail) return;
    if (!selectedDownloadFileIds.length) {
      setError("Please select at least one file to download.");
      return;
    }
    setPendingDownloadConfirm(true);
  }

  async function confirmDownloadSelectedFiles() {
    if (!backupDetail || !selectedDownloadFileIds.length) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(backupDownloadUrl(backupDetail.backup_id, selectedDownloadFileIds, downloadFilename));
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);

      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = normalizeZipFilename(downloadFilename || backupDetail.backup_name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
      setPendingDownloadConfirm(false);
    } catch (errorResponse) {
      setError(errorResponse instanceof Error ? errorResponse.message : "Download failed");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteCustomPath() {
    const path = pendingDeletePath;
    if (!path) return;

    setSaving(true);
    setError("");
    try {
      await deleteCustomBackupPath(path);
      setPendingDeletePath(null);
      setSelectedPaths((current) => current.filter((selectedPath) => selectedPath !== path));
      showToast({
        tone: "success",
        title: "Auto backup path removed",
        message: path,
      });
      router.refresh();
    } catch (errorResponse) {
      showToast({
        tone: "error",
        title: "Delete auto backup path failed",
        message: getErrorMessage(errorResponse, "Delete auto backup path failed"),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.actionGrid}>
        <button className={`${styles.actionCard} ${styles.primaryAction}`} onClick={() => openBackupModal()} type="button">
          <span><BackupIcon /></span>
          <div>
            <strong>New backup</strong>
            <p>เลือกหุ่นและ path ที่ต้องการสำรองข้อมูล</p>
          </div>
        </button>
        <button className={styles.actionCard} onClick={() => openModal("browse")} type="button">
          <span><FolderIcon /></span>
          <div>
            <strong>Browse robot files</strong>
            <p>ตรวจไฟล์/โฟลเดอร์บนหุ่นก่อนเลือก backup</p>
          </div>
        </button>
        <button className={styles.actionCard} onClick={() => openModal("cleanup")} type="button">
          <span><CleanupIcon /></span>
          <div>
            <strong>Cleanup old backups</strong>
            <p>{cleanupSettings ? `${cleanupSettings.enabled ? "Auto on" : "Auto off"} · ${cleanupSettings.older_than_days} days` : "Manage retention rule"}</p>
          </div>
        </button>
        <button className={styles.actionCard} onClick={() => openModal("autoBackup")} type="button">
          <span><BackupIcon /></span>
          <div>
            <strong>Auto backup</strong>
            <p>{autoBackupSettings ? `${autoBackupSettings.enabled ? "ON" : "OFF"} · every ${autoBackupSettings.interval_hours} hour(s)` : "Manage auto backup rule"}</p>
          </div>
          <b className={autoBackupSettings?.enabled ? styles.actionStatusOn : styles.actionStatusOff}>
            {autoBackupSettings?.enabled ? "ON" : "OFF"}
          </b>
        </button>
      </section>

      {error ? <p className={styles.pageError}>{error}</p> : null}

      <Panel title="Backup History">
        <PaginatedBackupsTable
          backups={backups}
          onDelete={requestDeleteBackup}
          onOpen={openBackupDetail}
        />
      </Panel>

      <section className={styles.cards}>
        <Panel title="Backup Paths">
          <div className={styles.pathList}>
            {targets.length ? (
              targets.map((target) => (
                <div className={styles.pathItem} key={target.key}>
                  <p>{target.label}: {target.path}</p>
                  {target.removable ? (
                    <button onClick={() => requestDeleteCustomPath(target.path)} type="button">
                      Delete
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <p>No auto backup paths configured yet. Add a custom path from New backup.</p>
            )}
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
                <h2>{mode === "autoBackup" ? "Auto backup settings" : mode === "cleanup" ? "Cleanup old backups" : mode === "browse" ? "Browse robot files" : mode === "detail" ? "Backup detail" : "Run backup"}</h2>
              </div>
              <button className={styles.closeButton} onClick={closeModal}>×</button>
            </div>

            {mode === "detail" ? (
              <div className={styles.detailBody}>
                {backupDetail ? (
                  <>
                    <div className={styles.detailSummary}>
                      <div>
                        <span>Backup package</span>
                        <strong>{backupDetail.backup_name}</strong>
                      </div>
                      <div className={styles.detailMeta}>
                        <b>{backupDetail.device_name ?? `Device #${backupDetail.device_id}`}</b>
                        <b>{backupDetail.total_file} file(s)</b>
                        <b>{Number(backupDetail.total_size_mb).toFixed(2)} MB</b>
                      </div>
                    </div>
                    <div className={styles.fileToolbar}>
                      <button onClick={toggleAllDownloadFiles} type="button">
                        {selectedDownloadFileIds.length === backupDetail.files.length ? "Clear selection" : "Select all"}
                      </button>
                      <span>
                        {selectedDownloadFileIds.length} / {backupDetail.files.length} selected for zip
                      </span>
                    </div>
                    <div className={styles.fileList}>
                      {backupDetail.files.map((file) => (
                        <button
                          className={selectedDownloadFileIds.includes(file.backup_file_id) ? styles.selectedFile : ""}
                          key={file.backup_file_id}
                          onClick={() => toggleDownloadFile(file.backup_file_id)}
                          type="button"
                        >
                          <input
                            checked={selectedDownloadFileIds.includes(file.backup_file_id)}
                            onChange={() => toggleDownloadFile(file.backup_file_id)}
                            onClick={(event) => event.stopPropagation()}
                            type="checkbox"
                          />
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
            ) : mode === "autoBackup" ? (
              <div className={styles.formGrid}>
                <label className={styles.checkRow}>
                  <input checked={autoBackupEnabled} onChange={(event) => setAutoBackupEnabled(event.target.checked)} type="checkbox" />
                  Enable auto backup
                </label>
                <label>
                  Interval hours
                  <input value={autoBackupIntervalHours} onChange={(event) => setAutoBackupIntervalHours(event.target.value)} inputMode="numeric" />
                  {autoBackupSettings ? (
                    <span className={styles.fieldHint}>
                      Current auto backup setting: every {autoBackupSettings.interval_hours} hour(s)
                    </span>
                  ) : null}
                </label>
                <label className={styles.checkRow}>
                  <input checked={autoBackupZipOutput} onChange={(event) => setAutoBackupZipOutput(event.target.checked)} type="checkbox" />
                  Zip output
                </label>
                <label className={styles.checkRow}>
                  <input checked={autoBackupRunOnStartup} onChange={(event) => setAutoBackupRunOnStartup(event.target.checked)} type="checkbox" />
                  Run on startup
                </label>
              </div>
            ) : mode === "cleanup" ? (
              <div className={styles.formGrid}>
                <label className={styles.checkRow}>
                  <input checked={cleanupEnabled} onChange={(event) => setCleanupEnabled(event.target.checked)} type="checkbox" />
                  Enable auto cleanup
                </label>
                <label>
                  Older than days
                  <input value={cleanupDays} onChange={(event) => setCleanupDays(event.target.value)} />
                  {cleanupSettings ? (
                    <span className={styles.fieldHint}>
                      Current auto cleanup setting: {cleanupSettings.older_than_days} day(s)
                    </span>
                  ) : null}
                </label>
                <label>
                  Interval hours
                  <input value={cleanupIntervalHours} onChange={(event) => setCleanupIntervalHours(event.target.value)} />
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
              <div className={mode === "backup" ? `${styles.formGrid} ${styles.backupForm}` : styles.formGrid}>
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
                    <label>
                      Backup name
                      <input
                        value={backupName}
                        onChange={(event) => setBackupName(event.target.value)}
                        placeholder="เช่น ก่อนแก้ flows หรือ Daily maps backup"
                      />
                    </label>
                    <div className={styles.selectionPanel}>
                      <div className={styles.selectionHeader}>
                        <div>
                          <strong>Backup targets</strong>
                          <span>{backupSelectionCount} selected</span>
                        </div>
                        <div className={styles.selectionActions}>
                          <button onClick={selectAllBackupTargets} type="button">Select all</button>
                          <button disabled={!backupSelectionCount} onClick={clearBackupTargets} type="button">Clear</button>
                        </div>
                      </div>
                      <div className={styles.targetList}>
                        {targets.length ? targets.map((target) => (
                          <label key={target.key}>
                            <input
                              checked={target.backup_api === "robot_db" ? includeDatabase : selectedPaths.includes(target.path)}
                              onChange={() => {
                                if (target.backup_api === "robot_db") setIncludeDatabase((current) => !current);
                                else togglePath(target.path);
                              }}
                              type="checkbox"
                            />
                            <span className={styles.targetText}>
                              <strong>{target.label}</strong>
                              <small>{target.path}</small>
                            </span>
                          <b className={`${styles.targetMeta} ${targetToneClass(target)}`}>
                            {target.backup_api === "robot_db" ? "DB JSON" : target.target_type}
                          </b>
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
                        )) : (
                          <p className={styles.emptyText}>No backup targets configured</p>
                        )}
                      </div>
                    </div>
                    <div className={styles.customPathRow}>
                      <label>
                        Add custom path
                        <input
                          value={customPath}
                          onChange={(event) => setCustomPath(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void addCustomPath();
                            }
                          }}
                          placeholder="/home/matrix/path/to/file-or-folder"
                        />
                      </label>
                      <button onClick={() => void addCustomPath()} type="button">Add path</button>
                    </div>
                    {backupSelectionCount ? (
                      <div className={styles.selectedPathList} aria-label="Selected backup targets">
                        {includeDatabase ? (
                          <button onClick={() => setIncludeDatabase(false)} type="button">
                            <span>Robot database JSON</span>
                            <b>×</b>
                          </button>
                        ) : null}
                        {selectedPaths.map((path) => (
                          <button key={path} onClick={() => togglePath(path)} type="button">
                            <span>{path}</span>
                            <b>×</b>
                          </button>
                        ))}
                      </div>
                    ) : null}
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
                <button onClick={downloadSelectedFiles} disabled={saving || !selectedDownloadFileIds.length}>
                  Download selected zip
                </button>
              ) : null}
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
              {mode === "backup" ? (
                <button onClick={() => submitBackup()} disabled={saving || !Number(deviceId) || !backupSelectionCount}>
                  {saving ? "Running..." : backupSelectionCount ? `Run backup (${backupSelectionCount})` : "Select targets first"}
                </button>
              ) : null}
              {mode === "browse" ? <button onClick={browseFiles} disabled={saving}>{saving ? "Loading..." : "Load files"}</button> : null}
              {mode === "autoBackup" ? <button onClick={saveAutoBackupSettings} disabled={saving}>{saving ? "Saving..." : "Save settings"}</button> : null}
              {mode === "cleanup" ? <button onClick={saveCleanupSettings} disabled={saving}>{saving ? "Saving..." : "Save settings"}</button> : null}
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

      {pendingDeletePath ? (
        <div className={styles.confirmOverlay} role="dialog" aria-modal="true" aria-labelledby="delete-path-title">
          <button className={styles.confirmBackdrop} onClick={() => !saving && setPendingDeletePath(null)} aria-label="Cancel delete" />
          <section className={styles.confirmDialog}>
            <div className={styles.confirmIcon}>!</div>
            <div className={styles.confirmContent}>
              <h2 id="delete-path-title">ยืนยันการลบ path</h2>
              <p>
                คุณต้องการลบ auto backup path นี้ใช่หรือไม่?
                path นี้จะไม่ถูกนำไปใช้ใน auto backup รอบถัดไป
              </p>
              <code>{pendingDeletePath}</code>
            </div>
            {error ? <p className={styles.formError}>{error}</p> : null}
            <div className={styles.confirmActions}>
              <button onClick={() => setPendingDeletePath(null)} disabled={saving}>Cancel</button>
              <button onClick={() => void confirmDeleteCustomPath()} disabled={saving}>
                {saving ? "Deleting..." : "Delete path"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingDownloadConfirm && backupDetail ? (
        <div className={styles.confirmOverlay} role="dialog" aria-modal="true" aria-labelledby="download-zip-title">
          <button className={styles.confirmBackdrop} onClick={() => setPendingDownloadConfirm(false)} aria-label="Cancel download" />
          <section className={`${styles.confirmDialog} ${styles.downloadDialog}`}>
            <div className={`${styles.confirmIcon} ${styles.downloadIcon}`}>↓</div>
            <div className={styles.confirmContent}>
              <h2 id="download-zip-title">ยืนยันการดาวน์โหลด</h2>
              <p>
                ตั้งชื่อไฟล์ zip ก่อนดาวน์โหลด {selectedDownloadFileIds.length} ไฟล์จาก {backupDetail.backup_name}
              </p>
              <label className={styles.downloadNameField}>
                Zip file name
                <input
                  autoFocus
                  value={downloadFilename}
                  onChange={(event) => setDownloadFilename(event.target.value)}
                  placeholder={`${backupDetail.backup_name}.zip`}
                />
              </label>
            </div>
            {error ? <p className={styles.formError}>{error}</p> : null}
            <div className={`${styles.confirmActions} ${styles.downloadActions}`}>
              <button onClick={() => setPendingDownloadConfirm(false)} disabled={saving}>Cancel</button>
              <button onClick={() => void confirmDownloadSelectedFiles()} disabled={saving}>
                {saving ? "Downloading..." : "Download zip"}
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

function normalizeZipFilename(filename: string): string {
  const safeName = filename.trim().replace(/[/:*?"<>|\\\x00-\x1f]+/g, "_").replace(/^[ ._-]+|[ ._-]+$/g, "");
  const fallback = "backup";
  const name = safeName || fallback;
  return name.toLowerCase().endsWith(".zip") ? name : `${name}.zip`;
}

function findParentFolder(path: string, selectedPaths: string[], targets: BackupTarget[]): string | null {
  return targets
    .filter((target) => target.backup_api === "file" && target.target_type === "directory")
    .map((target) => target.path.replace(/\/$/, ""))
    .filter((targetPath) => selectedPaths.includes(targetPath))
    .find((targetPath) => path !== targetPath && path.startsWith(`${targetPath}/`)) ?? null;
}

function targetToneClass(target: BackupTarget): string {
  if (target.backup_api === "robot_db") return styles.dbMeta;
  if (target.target_type === "directory") return styles.directoryMeta;
  return styles.fileMeta;
}

function findOpenedParentFolder(path: string, openedPath: string): string | null {
  const normalizedOpenedPath = openedPath.replace(/\/$/, "");
  if (!normalizedOpenedPath) return null;
  return path !== normalizedOpenedPath && path.startsWith(`${normalizedOpenedPath}/`) ? normalizedOpenedPath : null;
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}
