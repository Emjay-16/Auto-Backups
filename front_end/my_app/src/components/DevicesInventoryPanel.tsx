"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Device } from "@/lib/types";
import {
  createDevice,
  backupTargetTypeFromPath,
  getBackupTargets,
  listDeviceFiles,
  runCombinedBackup,
  saveCustomBackupPath,
  updateDevice,
  getDeviceBackupPaths,
  addDeviceBackupPath,
  deleteDeviceBackupPath,
  type BackupRunResult,
  type BackupTarget,
  type DeviceFormPayload,
  type DeviceGroupOption,
  type DeviceBackupPath,
  type RemoteFile,
} from "@/lib/api";
import styles from "@/styles/pages/devices/devices.module.css";
import { Panel } from "./Panel";
import { PaginatedDevicesTable } from "./PaginatedDevicesTable";
import { robotGroupTone } from "./RobotGroupBadge";
import { useToast } from "./ToastProvider";

type FormState = {
  groupId: string;
  deviceCode: string;
  deviceName: string;
  ipAddress: string;
  autoBackupEnabled: boolean;
  useOwnCredentials: boolean;
  sshUsername: string;
  sshPassword: string;
  sshPort: string;
};

type DeviceModalMode = "add" | "edit" | null;
type ActionModalMode = "browse" | "backup" | null;
type DeviceFilter =
  | { key: "all"; label: "All"; kind: "all" }
  | { key: `group:${number}`; label: string; kind: "group"; groupId: number }
  | { key: "online"; label: "Online"; kind: "online" };

function makeEmptyForm(groups: DeviceGroupOption[]): FormState {
  return {
    groupId: String(groups[0]?.group_id ?? ""),
    deviceCode: "",
    deviceName: "",
    ipAddress: "",
    autoBackupEnabled: true,
    useOwnCredentials: false,
    sshUsername: "",
    sshPassword: "",
    sshPort: "",
  };
}

export function DevicesInventoryPanel({ devices, groups }: { devices: Device[]; groups: DeviceGroupOption[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const groupOptions = groups;
  const [mode, setMode] = useState<DeviceModalMode>(null);
  const [actionMode, setActionMode] = useState<ActionModalMode>(null);
  const [activeFilter, setActiveFilter] = useState<DeviceFilter["key"]>("all");
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [form, setForm] = useState<FormState>(() => makeEmptyForm(groupOptions));
  const [devicePaths, setDevicePaths] = useState<DeviceBackupPath[]>([]);
  const [devicePathsLoading, setDevicePathsLoading] = useState(false);
  const [newDevicePath, setNewDevicePath] = useState("");
  const [newDevicePathLabel, setNewDevicePathLabel] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [backupTargets, setBackupTargets] = useState<BackupTarget[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [customBackupPathLabel, setCustomBackupPathLabel] = useState("");
  const [customBackupPath, setCustomBackupPath] = useState("");
  const [includeDatabase, setIncludeDatabase] = useState(false);
  const [backupName, setBackupName] = useState("");
  const [zipOutput, setZipOutput] = useState(false);
  const [remoteFiles, setRemoteFiles] = useState<RemoteFile[]>([]);
  const [openedPath, setOpenedPath] = useState("");
  const [backupResult, setBackupResult] = useState<BackupRunResult | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const filterOptions = useMemo<DeviceFilter[]>(() => [
    { key: "all", label: "All", kind: "all" },
    ...groupOptions.map((group) => ({
      key: `group:${group.group_id}` as const,
      label: group.group_name,
      kind: "group" as const,
      groupId: group.group_id,
    })),
    { key: "online", label: "Online", kind: "online" },
  ], [groupOptions]);
  const selectedFilter = filterOptions.find((filter) => filter.key === activeFilter) ?? filterOptions[0];
  const filteredDevices = useMemo(() => {
    if (selectedFilter.kind === "all") return devices;
    if (selectedFilter.kind === "online") return devices.filter((device) => device.status === "online");
    return devices.filter((device) => device.groupId === selectedFilter.groupId);
  }, [devices, selectedFilter]);

  function openAdd() {
    setSelectedDevice(null);
    setForm(makeEmptyForm(groupOptions));
    setDevicePaths([]);
    setNewDevicePath("");
    setNewDevicePathLabel("");
    setError("");
    setMode("add");
  }

  async function openEdit(device: Device) {
    setSelectedDevice(device);
    setForm({
      groupId: String(device.groupId ?? ""),
      deviceCode: device.code ?? "",
      deviceName: device.name,
      ipAddress: device.ip,
      autoBackupEnabled: device.autoBackupEnabled,
      useOwnCredentials: device.hasSshOverride,
      sshUsername: device.sshUsername ?? "",
      sshPassword: "",
      sshPort: device.sshPort ? String(device.sshPort) : "",
    });
    setDevicePaths([]);
    setNewDevicePath("");
    setNewDevicePathLabel("");
    setError("");
    setMode("edit");

    setDevicePathsLoading(true);
    try {
      const paths = await getDeviceBackupPaths(device.id);
      setDevicePaths(paths);
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Load device paths failed", message: getErrorMessage(errorResponse, "Load device paths failed") });
    } finally {
      setDevicePathsLoading(false);
    }
  }

  function closeModal() {
    if (saving) return;
    setMode(null);
    setActionMode(null);
    setSelectedDevice(null);
    setError("");
    setRemoteFiles([]);
    setOpenedPath("");
    setBackupResult(null);
    setSelectedPaths([]);
    setCustomBackupPathLabel("");
    setCustomBackupPath("");
    setIncludeDatabase(false);
    setBackupName("");
    setZipOutput(false);
    setBackupTargets([]);
    setDevicePaths([]);
    setNewDevicePath("");
    setNewDevicePathLabel("");
  }

  async function openBrowse(device: Device) {
    setSelectedDevice(device);
    setRemoteFiles([]);
    setBackupResult(null);
    setError("");
    setActionMode("browse");
    await loadRemoteFiles(device.id, remotePath);
  }

  async function openBackup(device: Device) {
    setSelectedDevice(device);
    setSelectedPaths([]);
    setCustomBackupPathLabel("");
    setCustomBackupPath("");
    setIncludeDatabase(false);
    setBackupName("");
    setZipOutput(false);
    setRemoteFiles([]);
    setOpenedPath("");
    setBackupResult(null);
    setError("");
    setActionMode("backup");
    try {
      setBackupTargets(await getBackupTargets());
    } catch (errorResponse) {
      setBackupTargets([]);
      showToast({ tone: "error", title: "Load backup targets failed", message: getErrorMessage(errorResponse, "Load backup targets failed") });
    }
  }

  function openRestore(device: Device) {
    router.push(device.id ? `/restore?device_id=${device.id}` : "/restore");
  }

  async function loadRemoteFiles(deviceId: number, path: string) {
    setSaving(true);
    setError("");
    try {
      const files = await listDeviceFiles(deviceId, path);
      setRemoteFiles(files);
      router.refresh();
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Load files failed", message: getErrorMessage(errorResponse, "Load files failed") });
    } finally {
      setSaving(false);
    }
  }

  async function submitBackup() {
    if (!selectedDevice?.id) {
      setError("Device is missing an API id. Please reload devices.");
      return;
    }

    const remotePaths = selectedPaths.filter((path) => path.startsWith("/"));

    if (!remotePaths.length && !includeDatabase) {
      setError("Please select at least one file, folder, or database JSON target.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const result = await runCombinedBackup({
        device_id: selectedDevice.id,
        remote_paths: remotePaths,
        include_database: includeDatabase,
        backup_name: backupName.trim() || undefined,
        zip_output: zipOutput,
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
      setSaving(false);
    }
  }

  async function openBackupTargetPath(path: string) {
    if (!selectedDevice?.id) {
      setError("Device is missing an API id. Please reload devices.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const files = await listDeviceFiles(selectedDevice.id, path);
      setRemoteFiles(files);
      setOpenedPath(path);
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Open folder failed", message: getErrorMessage(errorResponse, "Open folder failed") });
    } finally {
      setSaving(false);
    }
  }

  function toggleBackupPath(path: string) {
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

  async function addCustomBackupPath() {
    const path = customBackupPath.trim();
    if (!path) return;
    if (!path.startsWith("/")) {
      setError("Custom backup path must start with /");
      return;
    }
    try {
      const savedPath = await saveCustomBackupPath(path, customBackupPathLabel);
      setSelectedPaths((current) => uniquePaths([...current, savedPath.path]));
      setBackupTargets((current) => {
        if (current.some((target) => target.path === savedPath.path)) return current;
        const targetType = backupTargetTypeFromPath(savedPath.path);
        return [
          ...current,
          {
            key: `custom_${Date.now()}`,
            label: savedPath.label,
            path: savedPath.path,
            target_type: targetType,
            browsable: targetType === "directory",
            backup_api: "file",
            removable: true,
          },
        ];
      });
      setCustomBackupPathLabel("");
      setCustomBackupPath("");
      setError("");
      showToast({
        tone: "success",
        title: "Auto backup path added",
        message: `${savedPath.label}: ${savedPath.path}`,
      });
    } catch (errorResponse) {
      showToast({
        tone: "error",
        title: "Save auto backup path failed",
        message: getErrorMessage(errorResponse, "Save auto backup path failed"),
      });
    }
  }

  async function addDevicePath() {
    if (!selectedDevice?.id || !newDevicePath.trim()) return;
    try {
      const saved = await addDeviceBackupPath(selectedDevice.id, newDevicePath.trim(), newDevicePathLabel.trim() || undefined);
      setDevicePaths((current) => [...current.filter((target) => target.path !== saved.path), saved]);
      setNewDevicePath("");
      setNewDevicePathLabel("");
      showToast({ tone: "success", title: "Backup path added", message: `${saved.label}: ${saved.path}` });
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Add backup path failed", message: getErrorMessage(errorResponse, "Add backup path failed") });
    }
  }

  async function removeDevicePath(path: string) {
    if (!selectedDevice?.id) return;
    try {
      await deleteDeviceBackupPath(selectedDevice.id, path);
      setDevicePaths((current) => current.filter((target) => target.path !== path));
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Remove backup path failed", message: getErrorMessage(errorResponse, "Remove backup path failed") });
    }
  }

  async function submitForm() {
    setSaving(true);
    setError("");

    try {
      if (mode === "add") {
        await createDevice(buildCreatePayload(form));
      }

      if (mode === "edit") {
        if (!selectedDevice?.id) {
          throw new Error("Device is missing an API id. Please reload devices.");
        }
        await updateDevice(selectedDevice.id, buildUpdatePayload(form, selectedDevice));
      }

      setMode(null);
      setSelectedDevice(null);
      showToast({
        tone: "success",
        title: mode === "add" ? "Device added" : "Device updated",
        message: form.deviceName.trim() || selectedDevice?.name || "Device saved",
      });
      router.refresh();
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Save device failed", message: getErrorMessage(errorResponse, "Save device failed") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Panel
        title="Device Inventory"
        action={
          <div className={styles.panelActions}>
            <div className={styles.filters}>
              {filterOptions.map((filter) => (
                <button
                  className={`${activeFilter === filter.key ? styles.active : ""} ${filterToneClass(filter.label)}`}
                  key={filter.key}
                  onClick={() => setActiveFilter(filter.key)}
                  type="button"
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <button className={styles.addButton} onClick={openAdd} type="button">
              <span>+</span>
              Add device
            </button>
          </div>
        }
      >
        <PaginatedDevicesTable
          key={activeFilter}
          devices={filteredDevices}
          onBackup={openBackup}
          onBrowse={openBrowse}
          onEdit={openEdit}
          onRestore={openRestore}
        />
      </Panel>

      {mode ? (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`${mode} device`}>
          <button className={styles.backdrop} onClick={closeModal} aria-label="Close device form" type="button" />
          <section className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <p>{mode === "add" ? "Create device" : "Update device"}</p>
                <h2>{mode === "add" ? "Add device" : selectedDevice?.name}</h2>
              </div>
              <button className={styles.closeButton} onClick={closeModal} aria-label="Close" type="button">
                ×
              </button>
            </div>

            <div className={styles.formGrid}>
              <label>
                Group
                <select value={form.groupId} onChange={(event) => setForm({ ...form, groupId: event.target.value })}>
                  {!groupOptions.length ? <option value="">No groups available</option> : null}
                  {groupOptions.map((group) => (
                    <option key={group.group_id} value={group.group_id}>
                      {group.group_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Device code
                <input value={form.deviceCode} onChange={(event) => setForm({ ...form, deviceCode: event.target.value })} placeholder="4PS00901" />
              </label>
              <label>
                Device name
                <input value={form.deviceName} onChange={(event) => setForm({ ...form, deviceName: event.target.value })} placeholder="AMR01" />
              </label>
              <label>
                IP address
                <input value={form.ipAddress} onChange={(event) => setForm({ ...form, ipAddress: event.target.value })} placeholder="172.30.39.101" />
              </label>
              <label className={styles.checkboxField}>
                <input checked={form.autoBackupEnabled} onChange={(event) => setForm({ ...form, autoBackupEnabled: event.target.checked })} type="checkbox" />
                Auto backup this device
              </label>
            </div>

            <div className={styles.overrideSection}>
              <label className={styles.checkboxField}>
                <input
                  checked={form.useOwnCredentials}
                  onChange={(event) => setForm({ ...form, useOwnCredentials: event.target.checked })}
                  type="checkbox"
                />
                ตั้งค่า SSH login เฉพาะเครื่องนี้ (แยกจากค่ากลางของฟลีต)
              </label>
              {form.useOwnCredentials ? (
                <div className={styles.overrideFields}>
                  <label>
                    SSH username
                    <input
                      value={form.sshUsername}
                      onChange={(event) => setForm({ ...form, sshUsername: event.target.value })}
                      placeholder="pi"
                    />
                  </label>
                  <label>
                    SSH password{mode === "edit" && selectedDevice?.hasSshOverride ? " (เว้นว่างถ้าไม่เปลี่ยน)" : ""}
                    <input
                      value={form.sshPassword}
                      onChange={(event) => setForm({ ...form, sshPassword: event.target.value })}
                      type="password"
                      placeholder="••••••••"
                    />
                  </label>
                  <label>
                    SSH port
                    <input
                      value={form.sshPort}
                      onChange={(event) => setForm({ ...form, sshPort: event.target.value })}
                      placeholder="22"
                    />
                  </label>
                </div>
              ) : null}
            </div>

            {mode === "edit" ? (
              <div className={styles.overrideSection}>
                <span>Backup path เฉพาะเครื่องนี้ (แยกจาก path กลางของฟลีต)</span>
                {devicePathsLoading ? <p className={styles.hint}>กำลังโหลด...</p> : null}
                {devicePaths.length ? (
                  <div className={styles.selectedPathList}>
                    {devicePaths.map((target) => (
                      <button key={target.path} onClick={() => removeDevicePath(target.path)} type="button">
                        <span>{target.label}: {target.path}</span>
                        <b>×</b>
                      </button>
                    ))}
                  </div>
                ) : !devicePathsLoading ? (
                  <p className={styles.hint}>ยังไม่มี path เฉพาะเครื่อง — จะใช้ path กลางของฟลีตแทน</p>
                ) : null}
                <div className={styles.customPathRow}>
                  <label>
                    Path บนเครื่อง
                    <input value={newDevicePath} onChange={(event) => setNewDevicePath(event.target.value)} placeholder="/home/user/backup-data" />
                  </label>
                  <label>
                    ชื่อ (ไม่บังคับ)
                    <input value={newDevicePathLabel} onChange={(event) => setNewDevicePathLabel(event.target.value)} placeholder="App data" />
                  </label>
                  <button onClick={() => void addDevicePath()} type="button">+ เพิ่ม path</button>
                </div>
              </div>
            ) : null}

            {error ? <p className={styles.formError}>{error}</p> : null}

            <div className={styles.modalActions}>
              <button onClick={closeModal} type="button">Cancel</button>
              <button onClick={submitForm} disabled={saving} type="button">
                {saving ? "Saving..." : "Save device"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {actionMode ? (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`${actionMode} device`}>
          <button className={styles.backdrop} onClick={closeModal} aria-label="Close device action" type="button" />
          <section className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <p>{selectedDevice?.ip}</p>
                <h2>{actionMode === "browse" ? `Browse ${selectedDevice?.name}` : `Backup ${selectedDevice?.name}`}</h2>
              </div>
              <button className={styles.closeButton} onClick={closeModal} aria-label="Close" type="button">
                ×
              </button>
            </div>

            {actionMode === "browse" ? (
              <>
                <div className={styles.actionForm}>
                  <label>
                    Remote path
                    <input value={remotePath} onChange={(event) => setRemotePath(event.target.value)} />
                  </label>
                  <button
                    disabled={saving || !selectedDevice?.id}
                    onClick={() => selectedDevice?.id && loadRemoteFiles(selectedDevice.id, remotePath)}
                    type="button"
                  >
                    {saving ? "Loading..." : "Load files"}
                  </button>
                </div>
                <div className={styles.fileList}>
                  {remoteFiles.length ? (
                    remoteFiles.map((file) => (
                      <article key={file.path}>
                        <div>
                          <strong>{file.name}</strong>
                          <span>{file.path}</span>
                        </div>
                        <b>{file.file_type}</b>
                      </article>
                    ))
                  ) : (
                    <p>No files loaded</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className={styles.actionForm}>
                  <label>
                    Backup name
                    <input value={backupName} onChange={(event) => setBackupName(event.target.value)} placeholder="Optional" />
                  </label>
                  <div className={styles.backupSelectionSummary}>
                    <strong>{selectedPaths.length + (includeDatabase ? 1 : 0)}</strong>
                    <span>targets selected</span>
                  </div>
                  <div className={styles.targetList}>
                    {backupTargets.length ? backupTargets.map((target) => (
                      <label key={`${target.backup_api}:${target.path}:${target.key}`}>
                        <input
                          checked={target.backup_api === "robot_db" ? includeDatabase : selectedPaths.includes(target.path)}
                          onChange={() => {
                            if (target.backup_api === "robot_db") setIncludeDatabase((current) => !current);
                            else toggleBackupPath(target.path);
                          }}
                          type="checkbox"
                        />
                        <span>{target.label}: {target.path}</span>
                        <b>{target.backup_api === "robot_db" ? "DB JSON" : target.target_type}</b>
                        {target.browsable ? (
                          <button
                            onClick={(event) => {
                              event.preventDefault();
                              openBackupTargetPath(target.path);
                            }}
                            type="button"
                          >
                            Open
                          </button>
                        ) : null}
                      </label>
                    )) : <p>No backup targets loaded</p>}
                  </div>
                  <div className={styles.customPathRow}>
                    <label>
                      Path name
                      <input
                        value={customBackupPathLabel}
                        onChange={(event) => setCustomBackupPathLabel(event.target.value)}
                        placeholder="เช่น Robot rules"
                      />
                    </label>
                    <label>
                      Remote path
                      <input
                        value={customBackupPath}
                        onChange={(event) => setCustomBackupPath(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void addCustomBackupPath();
                          }
                        }}
                        placeholder="/home/matrix/path/to/file-or-folder"
                      />
                    </label>
                    <button onClick={() => void addCustomBackupPath()} type="button">Add path</button>
                  </div>
                  {selectedPaths.length ? (
                    <div className={styles.selectedPathList}>
                      {selectedPaths.map((path) => (
                        <button key={path} onClick={() => toggleBackupPath(path)} type="button">
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
                        <button onClick={() => setOpenedPath("")} type="button">Close</button>
                      </div>
                      {remoteFiles.length ? (
                        remoteFiles.map((file) => (
                          <label className={styles.fileRow} key={file.path}>
                            <input
                              checked={selectedPaths.includes(file.path)}
                              onChange={() => toggleBackupPath(file.path)}
                              type="checkbox"
                            />
                            <span>{file.name}</span>
                            {file.file_type === "directory" ? (
                              <button
                                onClick={(event) => {
                                  event.preventDefault();
                                  openBackupTargetPath(file.path);
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
                  <label className={styles.checkboxField}>
                    <input checked={zipOutput} onChange={(event) => setZipOutput(event.target.checked)} type="checkbox" />
                    Zip output
                  </label>
                </div>
                {backupResult ? (
                  <div className={styles.resultBox}>
                    <strong>{backupResult.message}</strong>
                    <span>{backupResult.local_path}</span>
                  </div>
                ) : null}
              </>
            )}

            {error ? <p className={styles.formError}>{error}</p> : null}

            <div className={styles.modalActions}>
              <button onClick={closeModal} type="button">Close</button>
              {actionMode === "backup" ? (
                <button onClick={submitBackup} disabled={saving} type="button">
                  {saving ? "Backing up..." : "Run backup"}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function buildCreatePayload(form: FormState): DeviceFormPayload {
  const groupId = Number(form.groupId);
  if (!groupId) {
    throw new Error("Please create a device group before adding devices.");
  }

  const payload: DeviceFormPayload = {
    group_id: groupId,
    device_code: form.deviceCode.trim(),
    device_name: form.deviceName.trim(),
    ip_address: form.ipAddress.trim(),
    device_status: 0,
    auto_backup_enabled: form.autoBackupEnabled,
  };

  if (form.useOwnCredentials) {
    const username = form.sshUsername.trim();
    const password = form.sshPassword;
    if (!username || !password) {
      throw new Error("กรุณากรอก SSH username และ password ให้ครบ ถ้าจะตั้งค่าเฉพาะเครื่องนี้");
    }
    payload.ssh_username = username;
    payload.ssh_password = password;
    if (form.sshPort.trim()) payload.ssh_port = Number(form.sshPort.trim());
  }

  return payload;
}

function buildUpdatePayload(form: FormState, original: Device): Partial<DeviceFormPayload> {
  const payload: Partial<DeviceFormPayload> = {};
  const groupId = Number(form.groupId);
  const deviceCode = form.deviceCode.trim();
  const deviceName = form.deviceName.trim();
  const ipAddress = form.ipAddress.trim();

  if (groupId && groupId !== original.groupId) payload.group_id = groupId;
  if (deviceCode && deviceCode !== original.code) payload.device_code = deviceCode;
  if (deviceName && deviceName !== original.name) payload.device_name = deviceName;
  if (ipAddress && ipAddress !== original.ip) payload.ip_address = ipAddress;
  if (form.autoBackupEnabled !== original.autoBackupEnabled) payload.auto_backup_enabled = form.autoBackupEnabled;

  if (form.useOwnCredentials) {
    const username = form.sshUsername.trim();
    if (!username) {
      throw new Error("กรุณากรอก SSH username");
    }
    if (!original.hasSshOverride && !form.sshPassword) {
      throw new Error("กรุณากรอก SSH password สำหรับตั้งค่าเฉพาะเครื่องนี้");
    }
    payload.ssh_username = username;
    if (form.sshPassword) payload.ssh_password = form.sshPassword;
    payload.ssh_port = form.sshPort.trim() ? Number(form.sshPort.trim()) : undefined;
  } else if (original.hasSshOverride) {
    payload.clear_ssh_override = true;
  }

  return payload;
}

function filterToneClass(filter: string): string {
  const tone = robotGroupTone(filter);
  if (tone === "amr") return styles.filterAmr;
  if (tone === "smr") return styles.filterSmr;
  if (tone === "smrl") return styles.filterSmrl;
  return "";
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

function getErrorMessage(errorResponse: unknown, fallback: string): string {
  return errorResponse instanceof Error ? errorResponse.message : fallback;
}
