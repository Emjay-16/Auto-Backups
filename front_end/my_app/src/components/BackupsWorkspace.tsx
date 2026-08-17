"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  backupDownloadUrl,
  backupTargetTypeFromPath,
  cleanupBackups,
  deleteCustomBackupPath,
  getAutoBackupSettings,
  getAutoCleanupSettings,
  getBackupDetail,
  listDeviceFiles,
  runCombinedBackup,
  saveBackupPathLabel,
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
import { AppModal } from "./AppModal";
import { PaginatedBackupsTable } from "./PaginatedBackupsTable";
import { Panel } from "./Panel";
import { StatusBadge } from "./StatusBadge";
import { useToast } from "./ToastProvider";

type ModalMode = "backup" | "browse" | "cleanup" | "autoBackup" | "detail" | "path" | null;

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
  const [customPathLabel, setCustomPathLabel] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [addedBackupTargets, setAddedBackupTargets] = useState<BackupTarget[]>([]);
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
  const [cleanupHours, setCleanupHours] = useState("0");
  const [cleanupEnabled, setCleanupEnabled] = useState(false);
  const [cleanupIntervalHours, setCleanupIntervalHours] = useState("720");
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
  const [editingPathTarget, setEditingPathTarget] = useState<BackupTarget | null>(null);
  const [selectedDeviceBackups, setSelectedDeviceBackups] = useState("");
  const backupTargets = useMemo(
    () => mergeBackupTargets(targets, addedBackupTargets),
    [targets, addedBackupTargets],
  );
  const defaultBrowsePath = backupTargets.find((target) => target.browsable)?.path ?? backupTargets[0]?.path ?? "";
  const backupSelectionCount = selectedPaths.length + (includeDatabase ? 1 : 0);
  const backupStats = useMemo(() => buildBackupStats(backups, usableDevices), [backups, usableDevices]);
  const selectedDeviceBackupSummary = useMemo(
    () => backupStats.deviceSummaries.find((summary) => deviceBackupKey(summary.device) === selectedDeviceBackups),
    [backupStats.deviceSummaries, selectedDeviceBackups],
  );
  const modalTitle = mode === "autoBackup"
    ? "Auto backup settings"
    : mode === "cleanup"
      ? "Cleanup old backups"
      : mode === "browse"
        ? "Browse robot files"
        : mode === "path"
          ? "Manage backup paths"
        : mode === "detail"
          ? "Backup detail"
          : "Run backup";

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
        setCleanupHours(String(cleanupRule.older_than_hours ?? 0));
        setCleanupEnabled(cleanupRule.enabled);
        setCleanupIntervalHours(String(cleanupRule.interval_hours));
        setCleanupKeepLatest(cleanupRule.keep_latest_per_device);
      });

    return () => {
      mounted = false;
    };
  }, []);

  function openModal(nextMode: ModalMode) {
    if (nextMode === "browse") {
      setBrowsePath(defaultBrowsePath);
      setRemoteFiles([]);
      setOpenedPath("");
    }
    setMode(nextMode);
    setResult(null);
    setError("");
  }

  function openBackupModal(databaseOnly = false) {
    setBackupName("");
    setSelectedPaths([]);
    setCustomPathLabel("");
    setCustomPath("");
    setIncludeDatabase(databaseOnly);
    setZipOutput(false);
    setRemoteFiles([]);
    setOpenedPath("");
    openModal("backup");
  }

  function openPathModal(target: BackupTarget | null = null) {
    setEditingPathTarget(target);
    setCustomPathLabel(target?.label ?? "");
    setCustomPath(target?.path ?? "");
    openModal("path");
  }

  function closeModal() {
    if (saving) return;
    if (mode === "browse") {
      setBrowsePath(defaultBrowsePath);
      setRemoteFiles([]);
      setOpenedPath("");
    }
    if (mode === "path") {
      setEditingPathTarget(null);
      setCustomPathLabel("");
      setCustomPath("");
    }
    setMode(null);
    setResult(null);
    setError("");
  }

  function resetBrowseState() {
    setBrowsePath(defaultBrowsePath);
    setRemoteFiles([]);
    setOpenedPath("");
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
        older_than_hours: Number(cleanupHours) > 0 ? Number(cleanupHours) : undefined,
        keep_latest_per_device: cleanupKeepLatest,
      });
      setResult(response);
      showToast({
        tone: "success",
        title: "Cleanup completed",
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
        older_than_hours: Number(cleanupHours) > 0 ? Number(cleanupHours) : 0,
        interval_hours: Number(cleanupIntervalHours) || 720,
        keep_latest_per_device: cleanupKeepLatest,
      });
      setCleanupSettings(settings);
      setCleanupDays(String(settings.older_than_days));
      setCleanupHours(String(settings.older_than_hours ?? 0));
      setCleanupEnabled(settings.enabled);
      setCleanupIntervalHours(String(settings.interval_hours));
      setCleanupKeepLatest(settings.keep_latest_per_device);
      showToast({
        tone: "success",
        title: "Auto cleanup updated",
        message: `${settings.enabled ? "Enabled" : "Disabled"} · ${formatCleanupRetention(settings)}`,
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

      const parentFolder = findParentFolder(path, current, backupTargets) ?? findOpenedParentFolder(path, openedPath);
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
    setSelectedPaths(uniquePaths(backupTargets
      .filter((target) => target.backup_api !== "robot_db")
      .map((target) => target.path)));
    setIncludeDatabase(backupTargets.some((target) => target.backup_api === "robot_db"));
  }

  function clearBackupTargets() {
    setSelectedPaths([]);
    setIncludeDatabase(false);
  }

  async function saveCustomPath() {
    const path = customPath.trim();
    if (!path) return;
    if (!editingPathTarget && !path.startsWith("/")) {
      setError("Custom backup path must start with /");
      return;
    }
    setSaving(true);
    try {
      const savedPath = editingPathTarget && !editingPathTarget.removable
        ? await saveBackupPathLabel(path, customPathLabel)
        : await saveCustomBackupPath(path, customPathLabel);
      if (!editingPathTarget && savedPath.path.startsWith("/")) {
        setSelectedPaths((current) => uniquePaths([...current, savedPath.path]));
      }
      setAddedBackupTargets((current) => {
        if (current.some((target) => target.path === savedPath.path)) {
          return current.map((target) => (
            target.path === savedPath.path
              ? { ...target, label: savedPath.label }
              : target
          ));
        }

        const targetType = editingPathTarget?.target_type ?? backupTargetTypeFromPath(savedPath.path);
        return [
          ...current,
          {
            key: editingPathTarget?.key ?? `custom_${Date.now()}`,
            label: savedPath.label,
            path: savedPath.path,
            target_type: targetType,
            browsable: editingPathTarget?.browsable ?? targetType === "directory",
            backup_api: editingPathTarget?.backup_api ?? "file",
            removable: editingPathTarget?.removable ?? true,
          },
        ];
      });
      setCustomPathLabel("");
      setCustomPath("");
      setError("");
      showToast({
        tone: "success",
        title: editingPathTarget ? "Backup path renamed" : "Auto backup path added",
        message: `${savedPath.label}: ${savedPath.path}`,
      });
      setEditingPathTarget(null);
      router.refresh();
    } catch (errorResponse) {
      showToast({
        tone: "error",
        title: "Save auto backup path failed",
        message: getErrorMessage(errorResponse, "Save auto backup path failed"),
      });
    } finally {
      setSaving(false);
    }
  }

  function requestDeleteCustomPath(path: string) {
    setPendingDeletePath(path);
    if (mode === "path") {
      setMode(null);
      setEditingPathTarget(null);
      setCustomPathLabel("");
      setCustomPath("");
    }
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

  function confirmDownloadSelectedFiles() {
    if (!backupDetail || !selectedDownloadFileIds.length) return;
    setError("");
    const link = document.createElement("a");
    link.href = backupDownloadUrl(
      backupDetail.backup_id,
      selectedDownloadFileIds,
      normalizeZipFilename(downloadFilename || backupDetail.backup_name),
    );
    link.download = normalizeZipFilename(downloadFilename || backupDetail.backup_name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setPendingDownloadConfirm(false);
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
      setAddedBackupTargets((current) => current.filter((target) => target.path !== path));
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
      <div className={styles.leftColumn}>
        <section className={styles.overviewPanel}>
          <div className={styles.sectionIntro}>
            <span>Backup Control</span>
            <h2>Fleet backup inventory</h2>
          </div>
          <div className={styles.summaryGrid} aria-label="Backup summary">
            <div className={`${styles.summaryCard} ${styles.summaryTotal}`}>
              <span>Total backups</span>
              <strong>{backups.length}</strong>
              <p>{backupStats.successCount} success · {backupStats.failedCount} failed</p>
            </div>
            <div className={`${styles.summaryCard} ${styles.summaryDevices}`}>
              <span>Devices covered</span>
              <strong>{backupStats.coveredDevices} / {usableDevices.length}</strong>
              <p>{backupStats.missingDevices} device(s) without backup</p>
            </div>
            <div className={`${styles.summaryCard} ${styles.summaryStorage}`}>
              <span>Total storage</span>
              <strong>{formatSizeMb(backupStats.totalSizeMb)}</strong>
              <p>Across {backupStats.totalFiles} file(s)</p>
            </div>
            <div className={`${styles.summaryCard} ${styles.summaryLatest}`}>
              <span>Latest backup</span>
              <strong>{backupStats.latestBackup?.device ?? "-"}</strong>
              <p>{backupStats.latestBackup?.createdAt ?? "No backup yet"}</p>
            </div>
          </div>
        </section>

        {error ? <p className={styles.pageError}>{error}</p> : null}

        <div className={styles.mainStack}>
          <Panel title="Backup by Device">
            <div className={styles.deviceBackupGrid}>
              {backupStats.deviceSummaries.length ? backupStats.deviceSummaries.map((summary) => (
                <article className={`${styles.deviceBackupCard} ${summary.total ? styles.hasBackup : styles.noBackup}`} key={summary.device.id ?? summary.device.ip ?? summary.device.name}>
                  <div className={styles.deviceBackupHeader}>
                    <span className={styles.groupPill}>{summary.device.group}</span>
                    <div>
                      <strong>{summary.device.name}</strong>
                      <p>{summary.device.ip}</p>
                    </div>
                  </div>
                  <div className={styles.deviceBackupMetrics}>
                    <span>
                      <b>{summary.total}</b>
                      backups
                    </span>
                    <span>
                      <b>{formatSizeMb(summary.totalSizeMb)}</b>
                      used
                    </span>
                    <span>
                      <b>{summary.latest?.createdAt ?? "-"}</b>
                      latest
                    </span>
                  </div>
                  <div className={styles.deviceBackupFooter}>
                    <span className={summary.total ? styles.covered : styles.missing}>
                      {summary.total ? `${summary.success} success · ${summary.failed} failed` : "No backup yet"}
                    </span>
                    <button
                      disabled={!summary.latest}
                      onClick={() => setSelectedDeviceBackups(deviceBackupKey(summary.device))}
                      type="button"
                    >
                      View backups
                    </button>
                  </div>
                </article>
              )) : (
                <p className={styles.emptyDeviceBackups}>No devices available.</p>
              )}
            </div>
          </Panel>

          {selectedDeviceBackupSummary ? (
            <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`Backups for ${selectedDeviceBackupSummary.device.name}`}>
              <button className={styles.backdrop} onClick={() => setSelectedDeviceBackups("")} aria-label="Close backups by device" type="button" />
              <section className={`${styles.modal} ${styles.deviceHistoryModal}`}>
                <div className={styles.modalHeader}>
                  <div>
                    <p>{selectedDeviceBackupSummary.device.ip}</p>
                    <h2>{selectedDeviceBackupSummary.device.name} backups</h2>
                  </div>
                  <button className={styles.closeButton} onClick={() => setSelectedDeviceBackups("")} type="button">×</button>
                </div>
                <div className={styles.deviceHistoryBody}>
                  <div className={styles.deviceHistorySummary}>
                    <span>
                      <b>{selectedDeviceBackupSummary.total}</b>
                      backup round(s)
                    </span>
                    <span>
                      <b>{formatSizeMb(selectedDeviceBackupSummary.totalSizeMb)}</b>
                      total size
                    </span>
                    <span>
                      <b>{selectedDeviceBackupSummary.latest?.createdAt ?? "-"}</b>
                      latest
                    </span>
                  </div>
                  <div className={styles.backupGroupList}>
                    {groupBackupsByName(selectedDeviceBackupSummary.backups).map((group) => (
                      <article className={styles.backupGroup} key={`${selectedDeviceBackupSummary.device.id ?? selectedDeviceBackupSummary.device.ip}:${group.name}`}>
                        <div className={styles.backupGroupHeader}>
                          <span className={styles.folderIcon}><FolderIcon /></span>
                          <div>
                            <strong>{group.name}</strong>
                            <p>{group.backups.length} round(s)</p>
                          </div>
                        </div>
                        <div className={styles.backupRoundList}>
                          {group.backups.map((backup, index) => (
                            <button
                              className={styles.backupRound}
                              disabled={!backup.id}
                              key={`${backup.id ?? `${backup.device}-${backup.name}`}-${backup.createdAtRaw ?? backup.createdAt}-${index}`}
                              onClick={() => {
                                setSelectedDeviceBackups("");
                                void openBackupDetail(backup);
                              }}
                              type="button"
                            >
                              <span>
                                <b>{formatBackupDateTime(backup.createdAtRaw ?? backup.createdAt).date}</b>
                                <small>{formatBackupDateTime(backup.createdAtRaw ?? backup.createdAt).time}</small>
                              </span>
                              <span>
                                <b>{backup.files} file(s)</b>
                                <small>{backup.size}</small>
                              </span>
                              <StatusBadge status={backup.status} />
                            </button>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          <Panel title="Backup History">
            <PaginatedBackupsTable
              backups={backups}
              onDelete={requestDeleteBackup}
              onOpen={openBackupDetail}
            />
          </Panel>

        </div>
      </div>

      <aside className={styles.rightColumn}>
        <section className={styles.commandPanel} aria-label="Backup actions">
          <div className={styles.commandHeader}>
            <span>Actions</span>
            <strong>Backup tasks</strong>
          </div>
          <div className={styles.actionGrid}>
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
                <strong>Browse files</strong>
                <p>ตรวจไฟล์บนหุ่นก่อนเลือก backup</p>
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
            <button className={styles.actionCard} onClick={() => openModal("cleanup")} type="button">
              <span><CleanupIcon /></span>
              <div>
                <strong>Cleanup</strong>
                <p>{cleanupSettings ? `${cleanupSettings.enabled ? "Auto on" : "Auto off"} · ${formatCleanupRetention(cleanupSettings)}` : "Manage retention rule"}</p>
              </div>
            </button>
          </div>
        </section>

        <div className={styles.sideStack}>
          <Panel
            title="Backup Paths"
            action={(
              <button
                aria-label="Manage backup paths"
                className={styles.panelGearButton}
                onClick={() => openPathModal()}
                title="Manage backup paths"
                type="button"
              >
                ⚙
              </button>
            )}
          >
            <div className={styles.pathList}>
              {backupTargets.length ? (
                backupTargets.map((target) => (
                  <div className={styles.pathItem} key={`${target.backup_api}:${target.path}:${target.key}`}>
                    <p>
                      <strong>{target.label}</strong>
                      <span>{target.path}</span>
                    </p>
                  </div>
                ))
              ) : (
                <p>No auto backup paths configured yet. Add a custom path from New backup.</p>
              )}
            </div>
          </Panel>
        </div>
      </aside>

      {mode ? (
        <AppModal
          eyebrow="Backups API"
          title={modalTitle}
          onClose={closeModal}
          className={mode === "detail" ? styles.detailModal : mode === "path" ? styles.pathModal : ""}
          footer={(
            <>
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
                    createdAt: formatDisplayDateTime(backupDetail.created_at),
                    createdAtRaw: backupDetail.created_at,
                  })}
                  disabled={saving}
                  type="button"
                >
                  Delete
                </button>
              ) : null}
              <button onClick={closeModal} type="button">Close</button>
              {mode === "detail" && backupDetail ? (
                <button onClick={downloadSelectedFiles} disabled={saving || !selectedDownloadFileIds.length} type="button">
                  Download selected zip
                </button>
              ) : null}
              {mode === "backup" ? (
                <button onClick={() => submitBackup()} disabled={saving || !Number(deviceId) || !backupSelectionCount} type="button">
                  {saving ? "Running..." : backupSelectionCount ? `Run backup (${backupSelectionCount})` : "Select targets first"}
                </button>
              ) : null}
              {mode === "browse" ? <button onClick={browseFiles} disabled={saving} type="button">{saving ? "Loading..." : "Load files"}</button> : null}
              {mode === "path" && editingPathTarget?.removable ? (
                <button className={styles.dangerButton} onClick={() => requestDeleteCustomPath(editingPathTarget.path)} disabled={saving} type="button">
                  Delete path
                </button>
              ) : null}
              {mode === "path" ? (
                <button onClick={() => void saveCustomPath()} disabled={saving || !customPath.trim()} type="button">
                  {saving ? "Saving..." : editingPathTarget ? "Save name" : "Save path"}
                </button>
              ) : null}
              {mode === "autoBackup" ? <button onClick={saveAutoBackupSettings} disabled={saving} type="button">{saving ? "Saving..." : "Save settings"}</button> : null}
              {mode === "cleanup" ? <button onClick={saveCleanupSettings} disabled={saving} type="button">{saving ? "Saving..." : "Save settings"}</button> : null}
              {mode === "cleanup" ? <button onClick={submitCleanup} disabled={saving} type="button">{saving ? "Cleaning..." : "Run cleanup"}</button> : null}
            </>
          )}
        >

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
                    Current auto cleanup setting: {formatCleanupRetention(cleanupSettings)}
                  </span>
                ) : null}
              </label>
              <label>
                Older than hours (optional)
                <input value={cleanupHours} onChange={(event) => setCleanupHours(event.target.value)} />
                <span className={styles.fieldHint}>
                  ถ้าใส่มากกว่า 0 ระบบจะใช้ชั่วโมงแทนจำนวนวัน เหมาะสำหรับทดสอบ
                </span>
              </label>
              <label>
                Interval hours
                <input value={cleanupIntervalHours} onChange={(event) => setCleanupIntervalHours(event.target.value)} />
              </label>
              <label className={styles.checkRow}>
                <input checked={cleanupKeepLatest} onChange={(event) => setCleanupKeepLatest(event.target.checked)} type="checkbox" />
                Keep latest per device
              </label>
            </div>
          ) : mode === "path" ? (
            <div className={styles.pathManager}>
              <div className={styles.pathManagerIntro}>
                <div>
                  <span>Backup target manager</span>
                  <strong>ตั้งชื่อ path ที่ใช้ backup และจัดการ custom path</strong>
                </div>
                <b>{backupTargets.length} path(s)</b>
              </div>
              <div className={`${styles.formGrid} ${styles.pathForm}`}>
                <div className={styles.pathFormTitle}>
                  <span>{editingPathTarget ? "Editing path" : "Add custom path"}</span>
                  <strong>{editingPathTarget ? editingPathTarget.label : "เพิ่ม path ใหม่สำหรับ auto backup"}</strong>
                  {editingPathTarget ? (
                    <button
                      onClick={() => {
                        setEditingPathTarget(null);
                        setCustomPathLabel("");
                        setCustomPath("");
                      }}
                      type="button"
                    >
                      Cancel edit
                    </button>
                  ) : null}
                </div>
                <label>
                  Path name
                  <input
                    value={customPathLabel}
                    onChange={(event) => setCustomPathLabel(event.target.value)}
                    placeholder="เช่น Robot rules"
                  />
                  <span className={styles.fieldHint}>
                    ชื่อนี้จะแสดงใน Backup Paths และรายการ selection
                  </span>
                </label>
                <label>
                  Remote path
                  <input
                    value={customPath}
                    onChange={(event) => setCustomPath(event.target.value)}
                    disabled={Boolean(editingPathTarget)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveCustomPath();
                      }
                    }}
                    placeholder="/home/matrix/path/to/file-or-folder"
                  />
                  <span className={styles.fieldHint}>
                    {editingPathTarget ? "แก้ path ไม่ได้ ถ้าต้องการเปลี่ยน path ให้ลบแล้วเพิ่มใหม่" : "เพิ่ม custom path ใหม่สำหรับ auto backup"}
                  </span>
                </label>
              </div>

              <div className={styles.pathManagerList}>
                {backupTargets.map((target) => (
                  <article
                    className={`${styles.pathManagerItem} ${editingPathTarget?.path === target.path ? styles.isEditing : ""}`}
                    key={`${target.backup_api}:${target.path}:${target.key}`}
                  >
                    <div>
                      <strong>
                        {target.label}
                        <b className={`${styles.pathTypeBadge} ${targetToneClass(target)}`}>
                          {target.backup_api === "robot_db" ? "DB" : target.target_type}
                        </b>
                      </strong>
                      <span>{target.path}</span>
                    </div>
                    <button
                      onClick={() => {
                        setEditingPathTarget(target);
                        setCustomPathLabel(target.label);
                        setCustomPath(target.path);
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                  </article>
                ))}
              </div>
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
                        type="button"
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
                      {backupTargets.length ? backupTargets.map((target) => (
                        <label key={`${target.backup_api}:${target.path}:${target.key}`}>
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
                        <button onClick={resetBrowseState} type="button">Close</button>
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
        </AppModal>
      ) : null}

      {pendingDeleteBackup ? (
        <div className={styles.confirmOverlay} role="dialog" aria-modal="true" aria-labelledby="delete-backup-title">
          <button className={styles.confirmBackdrop} onClick={() => !saving && setPendingDeleteBackup(null)} aria-label="Cancel delete" type="button" />
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
              <button onClick={() => setPendingDeleteBackup(null)} disabled={saving} type="button">Cancel</button>
              <button onClick={confirmDeleteBackup} disabled={saving} type="button">
                {saving ? "Deleting..." : "Delete backup"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingDeletePath ? (
        <div className={styles.confirmOverlay} role="dialog" aria-modal="true" aria-labelledby="delete-path-title">
          <button className={styles.confirmBackdrop} onClick={() => !saving && setPendingDeletePath(null)} aria-label="Cancel delete" type="button" />
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
              <button onClick={() => setPendingDeletePath(null)} disabled={saving} type="button">Cancel</button>
              <button onClick={() => void confirmDeleteCustomPath()} disabled={saving} type="button">
                {saving ? "Deleting..." : "Delete path"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingDownloadConfirm && backupDetail ? (
        <div className={styles.confirmOverlay} role="dialog" aria-modal="true" aria-labelledby="download-zip-title">
          <button className={styles.confirmBackdrop} onClick={() => setPendingDownloadConfirm(false)} aria-label="Cancel download" type="button" />
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
              <button onClick={() => setPendingDownloadConfirm(false)} disabled={saving} type="button">Cancel</button>
              <button onClick={confirmDownloadSelectedFiles} disabled={saving} type="button">
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
      <strong>Cleanup completed</strong>
      <span>{result.candidates} candidates · {result.deleted} deleted · {result.skipped} skipped</span>
    </div>
  );
}

function getErrorMessage(errorResponse: unknown, fallback: string): string {
  return errorResponse instanceof Error ? errorResponse.message : fallback;
}

function buildBackupStats(backups: Backup[], devices: Device[]) {
  const backupsByDevice = new Map<string, Backup[]>();
  backups.forEach((backup) => {
    const key = backup.device;
    backupsByDevice.set(key, [...(backupsByDevice.get(key) ?? []), backup]);
  });

  const latestBackup = [...backups]
    .sort((a, b) => backupTimeValue(b) - backupTimeValue(a))[0];
  const successCount = backups.filter((backup) => backup.status === "success").length;
  const failedCount = backups.filter((backup) => backup.status === "failed").length;
  const totalFiles = backups.reduce((sum, backup) => sum + (Number(backup.files) || 0), 0);
  const totalSizeMb = backups.reduce((sum, backup) => sum + parseSizeToMb(backup.size), 0);

  const deviceSummaries = devices
    .map((device) => {
      const deviceBackups = backupsByDevice.get(device.name) ?? [];
      const sortedBackups = [...deviceBackups].sort((a, b) => backupTimeValue(b) - backupTimeValue(a));
      return {
        device,
        backups: sortedBackups,
        latest: sortedBackups[0],
        total: deviceBackups.length,
        success: deviceBackups.filter((backup) => backup.status === "success").length,
        failed: deviceBackups.filter((backup) => backup.status === "failed").length,
        totalSizeMb: deviceBackups.reduce((sum, backup) => sum + parseSizeToMb(backup.size), 0),
      };
    })
    .sort((a, b) => {
      if (a.total !== b.total) return b.total - a.total;
      return a.device.name.localeCompare(b.device.name);
    });

  const coveredDevices = deviceSummaries.filter((summary) => summary.total > 0).length;

  return {
    coveredDevices,
    deviceSummaries,
    failedCount,
    latestBackup,
    missingDevices: Math.max(0, devices.length - coveredDevices),
    successCount,
    totalFiles,
    totalSizeMb,
  };
}

function backupTimeValue(backup: Backup): number {
  const parsed = Date.parse(backup.createdAtRaw ?? backup.createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseSizeToMb(size: string): number {
  const match = size.match(/([\d.]+)\s*(B|KB|MB|GB|TB)?/i);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const unit = (match[2] ?? "MB").toUpperCase();
  if (unit === "B") return value / (1024 * 1024);
  if (unit === "KB") return value / 1024;
  if (unit === "GB") return value * 1024;
  if (unit === "TB") return value * 1024 * 1024;
  return value;
}

function formatSizeMb(value: number): string {
  if (!value) return "0 MB";
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${value.toFixed(value >= 10 ? 1 : 2)} MB`;
}

function deviceBackupKey(device: Device): string {
  return String(device.id || `${device.ip || device.group}:${device.name}`);
}

function groupBackupsByName(backups: Backup[]) {
  const groups = new Map<string, Backup[]>();
  backups.forEach((backup) => {
    const groupName = backupGroupName(backup.name);
    groups.set(groupName, [...(groups.get(groupName) ?? []), backup]);
  });

  return Array.from(groups.entries()).map(([name, groupBackups]) => ({
    name,
    backups: [...groupBackups].sort((a, b) => backupTimeValue(b) - backupTimeValue(a)),
  }));
}

function backupGroupName(name: string): string {
  return name
    .replace(/[_-]\d{8}[_-]\d{6}$/u, "")
    .replace(/[_-]\d{8}$/u, "")
    .replace(/[_-]\d{4}-\d{2}-\d{2}[_-]\d{2}-\d{2}-\d{2}$/u, "")
    .trim() || name;
}

function formatBackupDateTime(value: string): { date: string; time: string } {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return { date: value || "-", time: "-" };
  const date = new Date(parsed);
  return {
    date: date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    time: date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
  };
}

function formatDisplayDateTime(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value || "-";
  const date = new Date(parsed);
  return date.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(value?: number | null): string {
  if (!value) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCleanupRetention(settings: AutoCleanupSettings): string {
  if (settings.older_than_hours > 0) {
    return `older than ${settings.older_than_hours} hour(s)`;
  }
  return `older than ${settings.older_than_days} day(s)`;
}

function normalizeZipFilename(filename: string): string {
  const safeName = filename.trim().replace(/[/:*?"<>|\\\x00-\x1f]+/g, "_").replace(/^[ ._-]+|[ ._-]+$/g, "");
  const fallback = "backup";
  const name = safeName || fallback;
  return name.toLowerCase().endsWith(".zip") ? name : `${name}.zip`;
}

function mergeBackupTargets(baseTargets: BackupTarget[], addedTargets: BackupTarget[]): BackupTarget[] {
  const targetByPath = new Map<string, BackupTarget>();
  baseTargets.forEach((target) => targetByPath.set(target.path, target));
  addedTargets.forEach((target) => targetByPath.set(target.path, target));
  return Array.from(targetByPath.values());
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
