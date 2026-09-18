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

interface FileGroup {
  groupKey: string;       // folder path ที่ใช้จัดกลุ่ม (parent directory)
  groupLabel: string;     // แสดงผลใน UI
  groupType: "database" | "zip" | "file";
  files: BackupFileDetail[];
  sharedTargetPath: string; // target path เริ่มต้นของกลุ่ม
}

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
  const [groupPaths, setGroupPaths] = useState<Record<string, string>>({}); // target path ต่อ group key
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [fallbackTargetPath, setFallbackTargetPath] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [result, setResult] = useState<RestoreRunResult | UploadRunResult | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [backupPage, setBackupPage] = useState(0);
  const [filesDialogOpen, setFilesDialogOpen] = useState(false);
  const [restoreSearchQuery, setRestoreSearchQuery] = useState("");

  useEffect(() => {
    let mounted = true;
    const loadingId = window.setTimeout(() => {
      if (mounted) setSaving(true);
    }, 0);
    Promise.all([getBackupsForUi(), getDevicesForUi()])
      .then(([backupItems, deviceItems]) => {
        if (!mounted) return;
        setBackups(backupItems.filter((backup) => backup.id));
        setDevices(deviceItems);

        const params = new URLSearchParams(window.location.search);
        const firstBackup = backupItems.find((backup) => backup.id);
        const backupId = params.get("backup_id") ?? String(firstBackup?.id ?? "");
        const deviceId = params.get("device_id") ?? "";
        setSelectedBackupId(backupId);
        setSelectedDeviceId(deviceId || (firstBackup?.deviceId ? String(firstBackup.deviceId) : ""));
      })
      .catch((errorResponse) => {
        if (!mounted) return;
        const message = getErrorMessage(errorResponse, "Load restore data failed");
        setError(message);
        showToast({ tone: "error", title: "Load restore data failed", message });
      })
      .finally(() => {
        if (mounted) setSaving(false);
      });

    return () => {
      mounted = false;
      window.clearTimeout(loadingId);
    };
  }, [showToast]);

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
        setSelectedDeviceId((current) => current || String(detail.device_id));
        setSelectedFileIds(detail.files.map((file) => file.backup_file_id));
        const perFilePaths = Object.fromEntries(
          detail.files.map((file) => [file.backup_file_id, inferRestoreTarget(file)]),
        );
        setTargetPaths(perFilePaths);
        // กำหนด groupPaths เริ่มต้น: ใช้ parent directory ของ target path เป็น key
        const initGroupPaths: Record<string, string> = {};
        for (const file of detail.files) {
          const gKey = getGroupKey(file);
          if (!(gKey in initGroupPaths)) {
            initGroupPaths[gKey] = getGroupDefaultPath(file);
          }
        }
        setGroupPaths(initGroupPaths);
        setExpandedGroups(new Set());
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
  const targetReady = restoreMode === "upload" ? Boolean(selectedDeviceId && fallbackTargetPath.trim()) : Boolean(selectedBackup && selectedDeviceId);

  // จัดกลุ่มไฟล์ตาม folder
  const fileGroups = useMemo<FileGroup[]>(() => {
    if (!backupDetail) return [];
    const groupMap = new Map<string, FileGroup>();
    for (const file of backupDetail.files) {
      const key = getGroupKey(file);
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          groupKey: key,
          groupLabel: getGroupLabel(file),
          groupType: isLikelyDatabaseBackupFile(file) ? "database" : isZipBackupFile(file) ? "zip" : "file",
          files: [],
          sharedTargetPath: getGroupDefaultPath(file),
        });
      }
      groupMap.get(key)!.files.push(file);
    }
    return Array.from(groupMap.values());
  }, [backupDetail]);

  const filteredFileGroups = useMemo(() => {
    const query = restoreSearchQuery.trim().toLowerCase();
    if (!query) return fileGroups;
    return fileGroups
      .map((group) => ({
        ...group,
        files: group.files.filter(
          (file) =>
            file.file_name.toLowerCase().includes(query) ||
            (file.remote_path && file.remote_path.toLowerCase().includes(query)) ||
            (file.file_path && file.file_path.toLowerCase().includes(query)),
        ),
      }))
      .filter((group) => group.files.length > 0);
  }, [fileGroups, restoreSearchQuery]);

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
    const selectedFiles = backupDetail.files.filter((file) => selectedFileIds.includes(file.backup_file_id));
    const missingPhysicalFile = selectedFiles.find((file) => file.file_exists === false);
    if (missingPhysicalFile) {
      setError(`ไฟล์ "${missingPhysicalFile.file_name}" ไม่มีอยู่จริงบนเซิร์ฟเวอร์ (โฟลเดอร์ storage/backups) หากคุณย้ายเครื่องหรือยังไม่ได้ก๊อปปี้ไฟล์มา โปรดคัดลอกไฟล์มาใส่ หรือใช้แท็บ Upload ด้านบนแทน`);
      return;
    }
    // สร้าง items โดย resolve target path จาก groupPaths → fallbackTargetPath
    const items = selectedFiles.map((file) => {
      const gKey = getGroupKey(file);
      const groupPath = groupPaths[gKey] ?? "";
      const resolvedPath = (groupPath || fallbackTargetPath).trim();
      // ถ้าเป็น database ไม่ต้องใส่ target path
      const targetPath = isLikelyDatabaseBackupFile(file) ? "" : resolvedPath;
      return { backup_file_id: file.backup_file_id, target_path: targetPath };
    });
    const missingTargetFile = selectedFiles.find(
      (file) => !isLikelyDatabaseBackupFile(file) && !items.find((item) => item.backup_file_id === file.backup_file_id)?.target_path,
    );
    if (missingTargetFile) {
      setError(`กรุณาระบุ Target path สำหรับกลุ่ม "${getGroupLabel(missingTargetFile)}"`);
      return;
    }

    setSaving(true);
    setError("");
    setResult(null);
    try {
      const response = await restoreBackup(backupId, {
        restored_by: 1,
        device_id: Number(selectedDeviceId),
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
                          setSelectedDeviceId(backup.deviceId ? String(backup.deviceId) : "");
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
                        <option value="">Select a device</option>
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
                    <label className={styles.destinationDeviceField}>
                      Destination device
                      <select value={selectedDeviceId} onChange={(event) => setSelectedDeviceId(event.target.value)}>
                        <option value="">Select a device</option>
                        {devices.filter((device) => device.id).map((device) => (
                          <option key={`${device.id}-${device.name}`} value={device.id}>
                            {device.name} · {device.ip}{device.name === selectedBackup?.device ? " · source" : ""}
                          </option>
                        ))}
                      </select>
                      <span className={styles.hint}>เลือกเครื่องปลายทางได้ แม้ไม่ใช่เครื่องที่สร้าง Backup นี้</span>
                    </label>
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
                    {backupDetail && backupDetail.files.some((f) => f.file_exists === false) ? (
                      <div className={styles.missingWarningCompact}>
                        <span>[!]</span>
                        <span>ไม่พบไฟล์จริงบางรายการบนดิสก์ (<button type="button" onClick={() => setRestoreMode("upload")}>ใช้โหมด Upload</button>)</span>
                      </div>
                    ) : null}
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
              <div className={styles.dialogSearch}>
                <input
                  type="text"
                  placeholder="ค้นหาไฟล์..."
                  value={restoreSearchQuery}
                  onChange={(e) => setRestoreSearchQuery(e.target.value)}
                />
              </div>
              <span>{selectedFileCount} selected · {filteredFileGroups.length} group(s)</span>
            </div>

            {backupDetail && backupDetail.files.some((f) => f.file_exists === false) ? (
              <div className={styles.missingWarning}>
                <span>[!]</span>
                <div>
                  <strong>มีไฟล์ backup บางรายการไม่พบบนดิสก์เซิร์ฟเวอร์ (storage/backups)</strong>
                  <p>หากย้ายระบบมาเครื่องใหม่โดยไม่ได้ก๊อปปี้ไฟล์ backup มาด้วย จะไม่สามารถกู้คืนไฟล์ที่มีป้ายเตือนสีแดงได้ คุณสามารถใช้โหมด Upload ด้านบนเพื่ออัปโหลดไฟล์จากเครื่องนี้แทนได้</p>
                </div>
              </div>
            ) : null}

            <div className={styles.files}>
              {backupDetail ? (
                <>
                  {filteredFileGroups.map((group) => {
                    const groupFileIds = group.files.map((f) => f.backup_file_id);
                    const selectedInGroup = groupFileIds.filter((id) => selectedFileIds.includes(id));
                    const allGroupSelected = selectedInGroup.length === groupFileIds.length;
                    const someGroupSelected = selectedInGroup.length > 0 && !allGroupSelected;
                    const isExpanded = expandedGroups.has(group.groupKey);
                    const hasMissing = group.files.some((f) => f.file_exists === false);
                    const currentGroupPath = groupPaths[group.groupKey] ?? group.sharedTargetPath;

                    return (
                      <article className={`${styles.groupRow} ${selectedInGroup.length > 0 ? styles.selectedFile : ""}`} key={group.groupKey}>
                        {/* Group header */}
                        <div className={styles.groupHeader}>
                          <label className={styles.groupCheckLabel}>
                            <input
                              type="checkbox"
                              checked={allGroupSelected}
                              ref={(el) => { if (el) el.indeterminate = someGroupSelected; }}
                              onChange={() => {
                                if (allGroupSelected) {
                                  setSelectedFileIds((cur) => cur.filter((id) => !groupFileIds.includes(id)));
                                } else {
                                  setSelectedFileIds((cur) => [...new Set([...cur, ...groupFileIds])]);
                                }
                              }}
                            />
                            <span className={styles.groupMeta}>
                              <span className={styles.fileTitleLine}>
                                <strong>{group.groupLabel}</strong>
                                <b className={`${styles.fileTypeBadge} ${group.groupType === "database" ? styles.databaseBadge : group.groupType === "zip" ? styles.zipBadge : ""}`}>
                                  {group.groupType}
                                </b>
                                {hasMissing ? (
                                  <b className={`${styles.fileTypeBadge} ${styles.missingBadge}`}>มีไฟล์หาย</b>
                                ) : null}
                              </span>
                              <small>{group.files.length} file(s) · {selectedInGroup.length} selected</small>
                            </span>
                          </label>
                          <button
                            className={styles.expandBtn}
                            type="button"
                            onClick={() => setExpandedGroups((cur) => {
                              const next = new Set(cur);
                              next.has(group.groupKey) ? next.delete(group.groupKey) : next.add(group.groupKey);
                              return next;
                            })}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? "ซ่อน" : "ดูไฟล์"}
                          </button>
                        </div>

                        {/* Group target path input (ไม่แสดงสำหรับ database) */}
                        {group.groupType !== "database" ? (
                          <div className={styles.groupPathRow}>
                            <span>TARGET FOLDER</span>
                            <input
                              value={currentGroupPath}
                              onChange={(e) => setGroupPaths((cur) => ({ ...cur, [group.groupKey]: e.target.value }))}
                              placeholder="/remote/path/on/robot"
                            />
                            {currentGroupPath !== group.sharedTargetPath && group.sharedTargetPath ? (
                              <button
                                className={styles.resetPathButton}
                                type="button"
                                onClick={() => setGroupPaths((cur) => ({ ...cur, [group.groupKey]: group.sharedTargetPath }))}
                              >
                                ใช้ path เดิม
                              </button>
                            ) : null}
                            {group.groupType === "zip" ? <p className={styles.hint}>ถ้า zip มีหลายไฟล์ ต้องใส่ path เป็นโฟลเดอร์ปลายทาง</p> : null}
                          </div>
                        ) : (
                          <div className={`${styles.groupPathRow} ${styles.databaseTarget}`}>
                            <span>Database restore</span>
                            <p>ใช้ค่า MySQL ของหุ่นตัวนี้ ไม่ต้องใส่ path ไฟล์</p>
                          </div>
                        )}

                        {/* Expanded file list */}
                        {isExpanded ? (
                          <ul className={styles.groupFileList}>
                            {group.files.map((file) => {
                              const isMissing = file.file_exists === false;
                              return (
                                <li key={file.backup_file_id} className={`${styles.groupFileItem} ${selectedFileIds.includes(file.backup_file_id) ? styles.groupFileSelected : ""}`}>
                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={selectedFileIds.includes(file.backup_file_id)}
                                      onChange={() => toggleFile(file.backup_file_id)}
                                    />
                                    <span>{file.file_name}</span>
                                  </label>
                                  <small>{Number(file.file_size_mb).toFixed(2)} MB</small>
                                  {isMissing ? (
                                    <b className={`${styles.fileTypeBadge} ${styles.missingBadge}`}>ไม่พบไฟล์</b>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
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

  const remotePath = typeof file.remote_path === "string" ? file.remote_path.trim() : "";
  if (
    remotePath &&
    !remotePath.startsWith("ssh+mysql://") &&
    !remotePath.startsWith("mysql://") &&
    !remotePath.startsWith("database://")
  ) {
    return remotePath;
  }

  if (file.file_name === "flows.json") return "/home/matrix/node-red-dev/node-red-user/flows.json";
  if (file.file_name === "matrix_robot.rules") return "/etc/udev/rules.d/matrix_robot.rules";

  const filePath = (file.file_path ?? "").replace(/\\/g, "/");
  const lowerPath = filePath.toLowerCase();
  const mapsRoot = "/home/matrix/public_web/ist_web_release/writable/uploads/maps";
  const soundsRoot = "/home/matrix/public_web/ist_web_release/writable/uploads/sounds";

  // Check if file is part of maps directory
  if (lowerPath.includes("/maps/")) {
    const mapsIndex = lowerPath.lastIndexOf("/maps/");
    const rel = filePath.slice(mapsIndex + "/maps/".length);
    return `${mapsRoot}/${rel}`;
  }

  // Check if file is part of sounds directory
  if (lowerPath.includes("/sounds/")) {
    const soundsIndex = lowerPath.lastIndexOf("/sounds/");
    const rel = filePath.slice(soundsIndex + "/sounds/".length);
    return `${soundsRoot}/${rel}`;
  }

  if (isZipBackupFile(file)) {
    if (file.file_name.toLowerCase().includes("maps") || lowerPath.includes("maps")) {
      return mapsRoot;
    }
    if (file.file_name.toLowerCase().includes("sounds") || lowerPath.includes("sounds")) {
      return soundsRoot;
    }
    return mapsRoot;
  }

  return `${mapsRoot}/${file.file_name}`;
}

function isLikelyDatabaseBackupFile(file: BackupFileDetail): boolean {
  const remotePath = typeof file.remote_path === "string" ? file.remote_path.trim().toLowerCase() : "";
  if (
    remotePath.startsWith("database://") ||
    remotePath.startsWith("ssh+mysql://") ||
    remotePath.startsWith("mysql://")
  ) {
    return true;
  }
  const filePath = (file.file_path ?? "").replace(/\\/g, "/").toLowerCase();
  const parts = filePath.split("/");
  const parentName = parts.length > 1 ? parts[parts.length - 2] : "";
  if (parentName.includes("ros_maps") || parentName === "istuvd") {
    return true;
  }
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

const MAPS_ROOT = "/home/matrix/public_web/ist_web_release/writable/uploads/maps";
const SOUNDS_ROOT = "/home/matrix/public_web/ist_web_release/writable/uploads/sounds";

/** Key สำหรับจัดกลุ่มไฟล์ตาม category (maps / sounds / database / etc.) */
function getGroupKey(file: BackupFileDetail): string {
  if (isLikelyDatabaseBackupFile(file)) return "__database__";

  const target = inferRestoreTarget(file);
  if (!target) return "__other__";

  // จัดกลุ่มทุกไฟล์ที่ target อยู่ใต้ maps root เข้ากลุ่มเดียวกัน
  if (target === MAPS_ROOT || target.startsWith(MAPS_ROOT + "/")) return MAPS_ROOT;
  if (target === SOUNDS_ROOT || target.startsWith(SOUNDS_ROOT + "/")) return SOUNDS_ROOT;

  // ไฟล์เดี่ยวที่รู้จัก
  if (target === "/home/matrix/node-red-dev/node-red-user/flows.json") return "__nodered__";
  if (target === "/etc/udev/rules.d/matrix_robot.rules") return "__udev__";

  // fallback: group by parent directory
  const slashIdx = target.lastIndexOf("/");
  return slashIdx > 0 ? target.slice(0, slashIdx) : target;
}

/** Label ที่แสดงใน group header */
function getGroupLabel(file: BackupFileDetail): string {
  const key = getGroupKey(file);
  if (key === "__database__") return "Database";
  if (key === MAPS_ROOT) return "Maps";
  if (key === SOUNDS_ROOT) return "Sounds";
  if (key === "__nodered__") return "Node-RED flows";
  if (key === "__udev__") return "udev rules";
  if (key === "__other__") return "Other files";
  const parts = key.split("/").filter(Boolean);
  const lastTwo = parts.slice(-2).join("/");
  return lastTwo;
}

/** Target path เริ่มต้นสำหรับ group (ใช้ category root) */
function getGroupDefaultPath(file: BackupFileDetail): string {
  const key = getGroupKey(file);
  if (key === "__database__" || key === "__other__") return "";
  if (key === "__nodered__") return "/home/matrix/node-red-dev/node-red-user/flows.json";
  if (key === "__udev__") return "/etc/udev/rules.d/matrix_robot.rules";
  return key; // maps root, sounds root, or parent directory
}

