"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  checkDeviceStatus,
  backupTargetLabelFromPath,
  backupTargetTypeFromPath,
  getBackupTargets,
  listDeviceFiles,
  runCombinedBackup,
  saveCustomBackupPath,
  type BackupTarget,
  type BackupRunResult,
  type DeviceStatusResult,
  type RemoteFile,
} from "@/lib/api";
import type { Device } from "@/lib/types";
import { ClockIcon } from "./ActionIcons";
import { RobotGroupBadge, robotGroupTone } from "./RobotGroupBadge";
import { useToast } from "./ToastProvider";
import styles from "@/styles/components/DeviceStatusPanel.module.css";

type DeviceStatusPanelProps = {
  devices: Device[];
};

const CLOSE_ANIMATION_MS = 150;

export function DeviceStatusPanel({ devices }: DeviceStatusPanelProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [liveStatus, setLiveStatus] = useState<DeviceStatusResult | null>(null);
  const [remoteFiles, setRemoteFiles] = useState<RemoteFile[]>([]);
  const [backupResult, setBackupResult] = useState<BackupRunResult | null>(null);
  const [backupTargets, setBackupTargets] = useState<BackupTarget[]>([]);
  const [browserPath, setBrowserPath] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [customPath, setCustomPath] = useState("");
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [openingDeviceId, setOpeningDeviceId] = useState<string | null>(null);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const modalRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const deviceRequestIdRef = useRef(0);
  const browseRequestIdRef = useRef(0);

  // Focus the close button when a device opens, and restore focus to whatever
  // triggered it once the modal is gone (keyboard users land back where they started).
  useEffect(() => {
    if (selectedDevice) {
      closeButtonRef.current?.focus();
    }
  }, [selectedDevice]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  async function openDevice(device: Device, triggerElement?: HTMLElement | null) {
    clearPendingClose();
    lastFocusedElementRef.current = triggerElement ?? null;

    const deviceKey = String(device.id ?? device.name);
    const requestId = ++deviceRequestIdRef.current;

    setSelectedDevice(device);
    setLiveStatus(null);
    setRemoteFiles([]);
    setBackupResult(null);
    setBrowserPath("");
    setSelectedPaths([]);
    setCustomPath("");
    setError("");
    setOpeningDeviceId(deviceKey);

    setLoading("status");
    try {
      const [status, targets] = await Promise.all([
        checkDeviceStatus(device.id),
        getBackupTargets(),
      ]);
      if (deviceRequestIdRef.current !== requestId) return;
      setLiveStatus(status);
      setBackupTargets(targets);
      setSelectedPaths([]);
    } catch (errorResponse) {
      if (deviceRequestIdRef.current !== requestId) return;
      showToast({ tone: "error", title: "Load device status failed", message: getErrorMessage(errorResponse, "Load device status failed") });
    } finally {
      if (deviceRequestIdRef.current === requestId) {
        setLoading("");
      }
      setOpeningDeviceId((current) => (current === deviceKey ? null : current));
    }
  }

  function clearPendingClose() {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsClosing(false);
  }

  function closeModal() {
    setIsClosing(true);
    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    closeTimeoutRef.current = window.setTimeout(() => {
      setIsClosing(false);
      setSelectedDevice(null);
      setLiveStatus(null);
      setRemoteFiles([]);
      setBackupResult(null);
      setBrowserPath("");
      setSelectedPaths([]);
      setCustomPath("");
      setError("");
      setOpeningPath(null);
      closeTimeoutRef.current = null;
      lastFocusedElementRef.current?.focus();
    }, prefersReducedMotion ? 0 : CLOSE_ANIMATION_MS);
  }

  // Escape closes the modal; Tab is trapped inside it while it's open.
  useEffect(() => {
    if (!selectedDevice) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
      }

      if (event.key === "Tab" && modalRef.current) {
        const focusable = getFocusableElements(modalRef.current);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedDevice]);

  async function openRemotePath(path: string) {
    if (!selectedDevice?.id) return;
    const requestId = ++browseRequestIdRef.current;

    setOpeningPath(path);
    setLoading("files");
    setError("");
    try {
      const files = await listDeviceFiles(selectedDevice.id, path);
      if (browseRequestIdRef.current !== requestId) return; // a newer folder was opened meanwhile
      setRemoteFiles(files);
      setBrowserPath(path);
    } catch (errorResponse) {
      if (browseRequestIdRef.current !== requestId) return;
      showToast({ tone: "error", title: "Browse files failed", message: getErrorMessage(errorResponse, "Browse files failed") });
    } finally {
      if (browseRequestIdRef.current === requestId) {
        setLoading("");
        setOpeningPath(null);
      }
    }
  }

  async function backupNow() {
    if (!selectedDevice?.id) return;
    const remotePaths = selectedPaths.filter((path) => path.startsWith("/"));
    const includeDatabase = backupTargets.some((target) => (
      target.backup_api === "robot_db" && selectedPaths.includes(target.path)
    ));

    if (!remotePaths.length && !includeDatabase) {
      setError("Please select at least one file or folder path.");
      return;
    }

    setLoading("backup");
    setError("");
    setBackupResult(null);
    try {
      const result = await runCombinedBackup({
        device_id: selectedDevice.id,
        remote_paths: remotePaths,
        include_database: includeDatabase,
      });
      setBackupResult(result);
      showToast({
        tone: "success",
        title: "Backup completed",
        message: `${result.backup_name} saved for ${result.device_name}`,
      });
      router.refresh();
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Backup failed", message: getErrorMessage(errorResponse, "Backup failed") });
    } finally {
      setLoading("");
    }
  }

  const shownStatus = liveStatus ? (liveStatus.online ? "online" : "offline") : selectedDevice?.status;
  const shownLastSeen = liveStatus?.last_seen_at ? formatTime(liveStatus.last_seen_at) : selectedDevice?.lastSeen;

  return (
    <>
      <div className={styles.grid}>
        {devices.length ? devices.map((device) => {
          const deviceKey = String(device.id ?? device.name);
          const isOpening = openingDeviceId === deviceKey;
          return (
            <button
              className={`${styles.card} ${styles[robotGroupTone(device.group)]}`}
              key={deviceKey}
              onClick={(event) => void openDevice(device, event.currentTarget)}
              disabled={isOpening}
              aria-busy={isOpening}
            >
              <div className={styles.header}>
                <RobotGroupBadge group={device.group} variant="avatar" />
                <div>
                  <strong>{device.name}</strong>
                  <span>{device.ip}</span>
                </div>
              </div>
              <div className={styles.footer}>
                <span className={styles.onlinePill}>
                  <i aria-hidden="true" />
                  online
                </span>
                <span className={styles.timePill}>
                  <ClockIcon />
                  {device.lastSeen}
                </span>
              </div>
              {isOpening ? (
                <div className={styles.cardBusy} aria-hidden="true">
                  <span className={styles.spinner} />
                </div>
              ) : null}
            </button>
          );
        }) : (
          <div className={styles.emptyState}>
            <strong>No online devices</strong>
            <span>Online robots will appear here when they are available.</span>
          </div>
        )}
      </div>

      {selectedDevice ? (
        <div
          className={`${styles.overlay} ${isClosing ? styles.closing : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="device-status-modal-title"
        >
          <button className={styles.backdrop} onClick={closeModal} aria-label="Close device detail" />
          <section className={styles.modal} ref={modalRef}>
            <div className={styles.modalHeader}>
              <div>
                <p>{selectedDevice.group} device</p>
                <h2 id="device-status-modal-title">{selectedDevice.name}</h2>
              </div>
              <button className={styles.close} onClick={closeModal} aria-label="Close" ref={closeButtonRef}>
                ×
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <article>
                  <span>Status</span>
                  <strong>{shownStatus ?? selectedDevice.status}</strong>
                </article>
                <article>
                  <span>IP Address</span>
                  <strong>{liveStatus?.ip_address ?? selectedDevice.ip}</strong>
                </article>
                <article>
                  <span>Last seen</span>
                  <strong>{shownLastSeen}</strong>
                </article>
                <article>
                  <span>Live check</span>
                  <strong>
                    {loading === "status" ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span className={styles.spinner} aria-hidden="true" />
                        Checking...
                      </span>
                    ) : (
                      liveStatus?.message ?? "Loaded from list"
                    )}
                  </strong>
                </article>
              </div>

              <div className={styles.paths}>
                <div className={styles.pathHeader}>
                  <h3>Backup targets</h3>
                  <span>{selectedPaths.length} selected</span>
                </div>
                <div className={styles.targetList}>
                  {backupTargets.length ? backupTargets.map((target) => (
                    target.backup_api === "file" ? (
                      <label className={styles.targetRow} key={target.key}>
                        <input
                          checked={selectedPaths.includes(target.path)}
                          onChange={() => togglePath(target.path)}
                          type="checkbox"
                        />
                        <span>{target.label}: {target.path}</span>
                        {target.browsable ? (
                          <button
                            onClick={(event) => {
                              event.preventDefault();
                              void openRemotePath(target.path);
                            }}
                            type="button"
                            disabled={openingPath === target.path}
                          >
                            {openingPath === target.path ? (
                              <>
                                <span className={styles.spinner} aria-hidden="true" />
                                Opening
                              </>
                            ) : (
                              "Open"
                            )}
                          </button>
                        ) : (
                          <b>{target.target_type}</b>
                        )}
                      </label>
                    ) : (
                      <label className={styles.targetRow} key={target.key}>
                        <input
                          checked={selectedPaths.includes(target.path)}
                          onChange={() => togglePath(target.path)}
                          type="checkbox"
                        />
                        <span>{target.label}</span>
                        <b>DB</b>
                      </label>
                    )
                  )) : <p>No backup targets loaded</p>}
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
                  <button onClick={() => void addCustomPath()} type="button" disabled={loading === "addPath"}>
                    {loading === "addPath" ? (
                      <>
                        <span className={styles.spinner} aria-hidden="true" />
                        Adding
                      </>
                    ) : (
                      "Add path"
                    )}
                  </button>
                </div>
                {selectedPaths.length ? (
                  <div className={styles.selectedPathList}>
                    {selectedPaths
                      .filter((path) => path.startsWith("/"))
                      .map((path) => (
                        <button key={path} onClick={() => togglePath(path)} type="button">
                          <span>{path}</span>
                          <b>×</b>
                        </button>
                      ))}
                  </div>
                ) : null}

                {browserPath ? (
                  <div className={styles.browser}>
                    <div className={styles.browserHeader}>
                      <strong>{browserPath}</strong>
                      <button onClick={() => setBrowserPath("")}>Close</button>
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
                                void openRemotePath(file.path);
                              }}
                              type="button"
                              disabled={openingPath === file.path}
                            >
                              {openingPath === file.path ? (
                                <>
                                  <span className={styles.spinner} aria-hidden="true" />
                                  Opening
                                </>
                              ) : (
                                "Open"
                              )}
                            </button>
                          ) : (
                            <b>{formatBytes(file.size_bytes)}</b>
                          )}
                        </label>
                      ))
                    ) : (
                      <p className={styles.emptyFiles}>{loading === "files" ? "Loading files..." : "No files found"}</p>
                    )}
                  </div>
                ) : null}
              </div>

              {backupResult ? (
                <div className={styles.result} role="status" aria-live="polite">
                  <strong>{backupResult.message}</strong>
                  <span>{backupResult.local_path}</span>
                </div>
              ) : null}
              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}
            </div>

            <div className={styles.actions}>
              <button onClick={() => void backupNow()} disabled={loading === "backup"}>
                {loading === "backup" ? (
                  <>
                    <span className={styles.spinner} aria-hidden="true" />
                    Backing up...
                  </>
                ) : (
                  "Backup now"
                )}
              </button>
              <button onClick={() => selectedDevice.id && router.push(`/restore?device_id=${selectedDevice.id}`)}>Restore</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );

  function togglePath(path: string) {
    setSelectedPaths((current) => {
      if (current.includes(path)) {
        return current.filter((item) => item !== path);
      }

      const parentFolder = findSelectedParentFolder(path, current, backupTargets) ?? findOpenedParentFolder(path, browserPath);
      const withoutParentFolder = parentFolder
        ? current.filter((item) => item !== parentFolder)
        : current;
      const next = [...withoutParentFolder, path];
      const openedParentFolder = findOpenedParentFolder(path, browserPath);

      if (!openedParentFolder || !remoteFiles.length) {
        return uniquePaths(next);
      }

      const visiblePaths = remoteFiles.map((file) => file.path);
      const allVisiblePathsSelected = visiblePaths.every((visiblePath) => next.includes(visiblePath));

      if (!allVisiblePathsSelected) {
        return uniquePaths(next);
      }

      return uniquePaths([
        ...next.filter((item) => !visiblePaths.includes(item)),
        openedParentFolder,
      ]);
    });
  }

  async function addCustomPath() {
    if (loading === "addPath") return;
    const path = customPath.trim();
    if (!path) return;
    if (!path.startsWith("/")) {
      setError("Custom backup path must start with /");
      return;
    }
    setLoading("addPath");
    try {
      const savedPath = await saveCustomBackupPath(path);
      setSelectedPaths((current) => uniquePaths([...current, savedPath.path]));
      setBackupTargets((current) => {
        if (current.some((target) => target.path === savedPath.path)) return current;
        const targetType = backupTargetTypeFromPath(savedPath.path);
        return [
          ...current,
          {
            key: `custom_${Date.now()}`,
            label: backupTargetLabelFromPath(savedPath.path),
            path: savedPath.path,
            target_type: targetType,
            browsable: targetType === "directory",
            backup_api: "file",
            removable: true,
          },
        ];
      });
      setCustomPath("");
      setError("");
      showToast({
        tone: "success",
        title: "Auto backup path added",
        message: savedPath.path,
      });
    } catch (errorResponse) {
      showToast({
        tone: "error",
        title: "Save auto backup path failed",
        message: getErrorMessage(errorResponse, "Save auto backup path failed"),
      });
    } finally {
      setLoading((current) => (current === "addPath" ? "" : current));
    }
  }
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (element) => element.offsetParent !== null,
  );
}

function formatTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function findSelectedParentFolder(path: string, selectedPaths: string[], targets: BackupTarget[]): string | null {
  return targets
    .filter((target) => target.backup_api === "file" && target.target_type === "directory")
    .map((target) => target.path)
    .filter((targetPath) => selectedPaths.includes(targetPath))
    .find((targetPath) => path !== targetPath && path.startsWith(`${targetPath.replace(/\/$/, "")}/`)) ?? null;
}

function findOpenedParentFolder(path: string, browserPath: string): string | null {
  const normalizedBrowserPath = browserPath.replace(/\/$/, "");
  if (!normalizedBrowserPath) return null;
  return path !== normalizedBrowserPath && path.startsWith(`${normalizedBrowserPath}/`) ? normalizedBrowserPath : null;
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

function formatBytes(value?: number | null): string {
  if (!value) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getErrorMessage(errorResponse: unknown, fallback: string): string {
  return errorResponse instanceof Error ? errorResponse.message : fallback;
}
