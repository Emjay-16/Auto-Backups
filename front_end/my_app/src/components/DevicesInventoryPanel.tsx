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
  deleteDevice,
  deleteDeviceBackupPath,
  getErrorMessage,
  type BackupRunResult,
  type BackupTarget,
  type DeviceFormPayload,
  type DeviceGroupOption,
  type DeviceBackupPath,
  type RemoteFile,
} from "@/lib/api";
import styles from "@/styles/pages/devices/devices.module.css";
import {
  AlertCircleIcon,
  ArrowUpIcon,
  BackupIcon,
  ChevronRightIcon,
  ClockIcon,
  DatabaseIcon,
  DeleteIcon,
  DeviceIcon,
  FileTextIcon,
  FolderIcon,
  PlusIcon,
  WifiIcon,
} from "./ActionIcons";
import { BackupProgressModal, type BackupProgressStatus } from "./BackupProgressModal";
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
  | { key: "online"; label: "Online"; kind: "status"; status: "online" }
  | { key: "pending"; label: "Pending"; kind: "status"; status: "pending" }
  | { key: "offline"; label: "Offline"; kind: "status"; status: "offline" };

const DEFAULT_BROWSE_PATH = "/home";

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

function getParentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return trimmed.slice(0, lastSlash);
}

export function DevicesInventoryPanel({
  devices,
  groups,
}: {
  devices: Device[];
  groups: DeviceGroupOption[];
}) {
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
  const [remotePath, setRemotePath] = useState(DEFAULT_BROWSE_PATH);
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
  const [filesLoading, setFilesLoading] = useState(false);
  const [pendingDeleteDevice, setPendingDeleteDevice] = useState<Device | null>(null);

  const [backupProgress, setBackupProgress] = useState<{
    isOpen: boolean;
    status: BackupProgressStatus;
    deviceName?: string;
    backupName?: string;
    targetCount?: number;
    result?: BackupRunResult | null;
    errorMessage?: string;
  }>({
    isOpen: false,
    status: "loading",
  });

  // Overview statistics
  const totalCount = devices.length;
  const onlineCount = useMemo(() => devices.filter((d) => d.status === "online").length, [devices]);
  const pendingCount = useMemo(() => devices.filter((d) => d.status === "pending").length, [devices]);
  const offlineCount = useMemo(() => devices.filter((d) => d.status === "offline").length, [devices]);

  // Filter options with counts
  const filterOptions = useMemo<DeviceFilter[]>(() => {
    const list: DeviceFilter[] = [
      { key: "all", label: "All", kind: "all" },
      ...groupOptions.map((group) => ({
        key: `group:${group.group_id}` as const,
        label: group.group_name,
        kind: "group" as const,
        groupId: group.group_id,
      })),
      { key: "online", label: "Online", kind: "status", status: "online" },
    ];
    if (offlineCount > 0) {
      list.push({ key: "offline", label: "Offline", kind: "status", status: "offline" });
    }
    if (pendingCount > 0) {
      list.push({ key: "pending", label: "Pending", kind: "status", status: "pending" });
    }
    return list;
  }, [groupOptions, offlineCount, pendingCount]);

  function getFilterCount(filter: DeviceFilter): number {
    if (filter.kind === "all") return devices.length;
    if (filter.kind === "status") return devices.filter((d) => d.status === filter.status).length;
    if (filter.kind === "group") return devices.filter((d) => d.groupId === filter.groupId).length;
    return 0;
  }

  const selectedFilter = filterOptions.find((filter) => filter.key === activeFilter) ?? filterOptions[0];

  // Filter devices by selected pill
  const filteredDevices = useMemo(() => {
    if (selectedFilter.kind === "all") return devices;
    if (selectedFilter.kind === "status") {
      return devices.filter((device) => device.status === selectedFilter.status);
    }
    return devices.filter((device) => device.groupId === selectedFilter.groupId);
  }, [devices, selectedFilter]);

  function handleStatCardClick(filterKey: "all" | "online" | "pending" | "offline") {
    if (filterKey === "all") {
      setActiveFilter("all");
    } else {
      setActiveFilter(activeFilter === filterKey ? "all" : filterKey);
    }
  }

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
      showToast({
        tone: "error",
        title: "Failed to load device backup paths",
        message: getErrorMessage(errorResponse, "Could not fetch custom backup paths for this device"),
      });
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

  async function confirmDeleteDevice() {
    if (!pendingDeleteDevice?.id) return;
    setSaving(true);
    try {
      await deleteDevice(pendingDeleteDevice.id);
      setPendingDeleteDevice(null);
      setMode(null);
      setSelectedDevice(null);
      showToast({ tone: "success", title: "Device deleted", message: pendingDeleteDevice.name });
      router.refresh();
    } catch (errorResponse) {
      showToast({ tone: "error", title: "Failed to delete device", message: getErrorMessage(errorResponse, "Could not delete device") });
    } finally {
      setSaving(false);
    }
  }

  async function openBrowse(device: Device) {
    setSelectedDevice(device);
    setRemoteFiles([]);
    setBackupResult(null);
    setError("");
    setRemotePath(DEFAULT_BROWSE_PATH);
    setActionMode("browse");
    await loadRemoteFiles(device.id, DEFAULT_BROWSE_PATH);
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
      showToast({
        tone: "error",
        title: "Failed to load backup targets",
        message: getErrorMessage(errorResponse, "Could not load targets for backup"),
      });
    }
  }

  function openRestore(device: Device) {
    router.push(device.id ? `/restore?device_id=${device.id}` : "/restore");
  }

  async function loadRemoteFiles(deviceId: number, path: string) {
    setFilesLoading(true);
    setError("");
    try {
      const files = await listDeviceFiles(deviceId, path);
      setRemoteFiles(files);
    } catch (errorResponse) {
      showToast({
        tone: "error",
        title: "Failed to load directory files",
        message: getErrorMessage(errorResponse, "Could not retrieve files from device"),
      });
    } finally {
      setFilesLoading(false);
    }
  }

  async function openBrowsePath(path: string) {
    setRemotePath(path);
    if (selectedDevice?.id) {
      await loadRemoteFiles(selectedDevice.id, path);
    }
  }

  function navigateToParent() {
    const parent = getParentPath(remotePath);
    void openBrowsePath(parent);
  }

  function handleCloseBackupProgress() {
    const wasSuccess = backupProgress.status === "success";
    setBackupProgress((current) => ({ ...current, isOpen: false }));
    if (wasSuccess) {
      closeModal();
    }
  }

  async function submitBackup() {
    if (!selectedDevice?.id) {
      setError("Device ID missing. Please refresh the page.");
      return;
    }

    const remotePaths = selectedPaths.filter((path) => path.startsWith("/"));

    if (!remotePaths.length && !includeDatabase) {
      setError("Please select at least one file, folder, or database to back up.");
      return;
    }

    const resolvedBackupName = backupName.trim() || undefined;
    const targetCount = remotePaths.length + (includeDatabase ? 1 : 0);

    setSaving(true);
    setError("");
    setBackupProgress({
      isOpen: true,
      status: "loading",
      deviceName: selectedDevice.name,
      backupName: resolvedBackupName,
      targetCount,
    });

    try {
      const result = await runCombinedBackup({
        device_id: selectedDevice.id,
        remote_paths: remotePaths,
        include_database: includeDatabase,
        backup_name: resolvedBackupName,
        zip_output: zipOutput,
      });
      setBackupResult(result);
      setBackupProgress({
        isOpen: true,
        status: "success",
        deviceName: result.device_name || selectedDevice.name,
        backupName: result.backup_name,
        result,
      });
      showToast({
        tone: "success",
        title: "Backup completed",
        message: `${result.backup_name} saved for ${result.device_name}`,
      });
      router.refresh();
    } catch (errorResponse) {
      const errorMsg = getErrorMessage(errorResponse, "Error occurred during backup execution");
      setBackupProgress({
        isOpen: true,
        status: "error",
        deviceName: selectedDevice.name,
        errorMessage: errorMsg,
      });
      showToast({ tone: "error", title: "Backup failed", message: errorMsg });
    } finally {
      setSaving(false);
    }
  }

  async function openBackupTargetPath(path: string) {
    if (!selectedDevice?.id) {
      setError("Device ID missing. Please refresh the page.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const files = await listDeviceFiles(selectedDevice.id, path);
      setRemoteFiles(files);
      setOpenedPath(path);
    } catch (errorResponse) {
      showToast({
        tone: "error",
        title: "Failed to open folder",
        message: getErrorMessage(errorResponse, "Could not open target directory on device"),
      });
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
      setError("Backup remote path must start with '/'");
      return;
    }
    try {
      const savedPath = await saveCustomBackupPath(path, customBackupPathLabel.trim() || undefined);
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
        title: "Custom target added",
        message: `${savedPath.label}: ${savedPath.path}`,
      });
    } catch (errorResponse) {
      showToast({
        tone: "error",
        title: "Failed to save backup target",
        message: getErrorMessage(errorResponse, "Could not save custom path"),
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
      showToast({ tone: "success", title: "เพิ่ม Path สำรองข้อมูลสำเร็จ", message: `${saved.label}: ${saved.path}` });
    } catch (errorResponse) {
      showToast({
        tone: "error",
        title: "ไม่สามารถเพิ่ม Path สำรองข้อมูลได้",
        message: getErrorMessage(errorResponse, "เกิดข้อผิดพลาดในการบันทึก Path สำหรับอุปกรณ์นี้"),
      });
    }
  }

  async function removeDevicePath(path: string) {
    if (!selectedDevice?.id) return;
    try {
      await deleteDeviceBackupPath(selectedDevice.id, path);
      setDevicePaths((current) => current.filter((target) => target.path !== path));
      showToast({ tone: "success", title: "ลบ Path สำรองข้อมูลแล้ว", message: path });
    } catch (errorResponse) {
      showToast({
        tone: "error",
        title: "ไม่สามารถลบ Path สำรองข้อมูลได้",
        message: getErrorMessage(errorResponse, "เกิดข้อผิดพลาดในการลบ Path"),
      });
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
          throw new Error("Device ID missing in system. Please refresh.");
        }
        await updateDevice(selectedDevice.id, buildUpdatePayload(form, selectedDevice));
      }

      const wasAdding = mode === "add";
      setMode(null);
      setSelectedDevice(null);
      showToast({
        tone: "success",
        title: wasAdding ? "Device added successfully" : "Device updated successfully",
        message: form.deviceName.trim() || selectedDevice?.name || "Settings saved",
      });
      router.refresh();
    } catch (errorResponse) {
      showToast({
        tone: "error",
        title: "Failed to save device",
        message: getErrorMessage(errorResponse, "Could not save device details"),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Modern Overview Stat Cards */}
      <section className={styles.overview}>
        <button
          className={`${styles.statCard} ${styles.statAll} ${activeFilter === "all" ? styles.statCardActive : ""}`}
          onClick={() => handleStatCardClick("all")}
          type="button"
        >
          <div className={styles.statTop}>
            <span className={styles.statLabel}>ALL DEVICES</span>
            <div className={styles.statIconWrapper}>
              <DeviceIcon />
            </div>
          </div>
          <div className={styles.statBody}>
            <strong className={styles.statValue}>{totalCount}</strong>
            <span className={styles.statSubtext}>Total registered in fleet</span>
          </div>
          <div className={styles.statBar} />
        </button>

        <button
          className={`${styles.statCard} ${styles.statOnline} ${activeFilter === "online" ? styles.statCardActive : ""}`}
          onClick={() => handleStatCardClick("online")}
          type="button"
        >
          <div className={styles.statTop}>
            <span className={styles.statLabel}>
              <span className={styles.pulseDot} />
              ONLINE
            </span>
            <div className={styles.statIconWrapper}>
              <WifiIcon />
            </div>
          </div>
          <div className={styles.statBody}>
            <strong className={`${styles.statValue} ${styles.onlineVal}`}>{onlineCount}</strong>
            <span className={styles.statSubtext}>Connected & operational</span>
          </div>
          <div className={styles.statBar} />
        </button>

        <button
          className={`${styles.statCard} ${styles.statPending} ${activeFilter === "pending" ? styles.statCardActive : ""}`}
          onClick={() => handleStatCardClick("pending")}
          type="button"
        >
          <div className={styles.statTop}>
            <span className={styles.statLabel}>PENDING</span>
            <div className={styles.statIconWrapper}>
              <ClockIcon />
            </div>
          </div>
          <div className={styles.statBody}>
            <strong className={`${styles.statValue} ${styles.pendingVal}`}>{pendingCount}</strong>
            <span className={styles.statSubtext}>Awaiting response</span>
          </div>
          <div className={styles.statBar} />
        </button>

        <button
          className={`${styles.statCard} ${styles.statOffline} ${activeFilter === "offline" ? styles.statCardActive : ""}`}
          onClick={() => handleStatCardClick("offline")}
          type="button"
        >
          <div className={styles.statTop}>
            <span className={styles.statLabel}>OFFLINE</span>
            <div className={styles.statIconWrapper}>
              <AlertCircleIcon />
            </div>
          </div>
          <div className={styles.statBody}>
            <strong className={`${styles.statValue} ${styles.offlineVal}`}>{offlineCount}</strong>
            <span className={styles.statSubtext}>Unreachable / Disconnected</span>
          </div>
          <div className={styles.statBar} />
        </button>
      </section>

      {/* Main Inventory Panel */}
      <Panel
        title="Device Inventory"
        action={
          <div className={styles.panelActions}>
            <div className={styles.filters}>
              {filterOptions.map((filter) => {
                const count = getFilterCount(filter);
                const isActive = activeFilter === filter.key;
                return (
                  <button
                    className={`${isActive ? styles.active : ""} ${filterToneClass(filter.label)}`}
                    key={filter.key}
                    onClick={() => setActiveFilter(filter.key)}
                    type="button"
                  >
                    <span>{filter.label}</span>
                    <span className={styles.filterCount}>{count}</span>
                  </button>
                );
              })}
            </div>

            <button className={styles.addButton} onClick={openAdd} type="button">
              <PlusIcon className={styles.addIcon} />
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

      {/* Add / Edit Device Modal */}
      {mode ? (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`${mode} device`}>
          <button className={styles.backdrop} onClick={closeModal} aria-label="Close device form" type="button" />
          <section className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <p>{mode === "add" ? "NEW DEVICE REGISTRATION" : "CONFIGURATION SETTINGS"}</p>
                <h2>{mode === "add" ? "Add New Device" : `Edit Device: ${selectedDevice?.name}`}</h2>
              </div>
              <button className={styles.closeButton} onClick={closeModal} aria-label="Close" type="button">
                ×
              </button>
            </div>

            <div className={styles.modalScrollBody}>
              {/* General Information */}
              <div className={styles.modalSection}>
                <h4 className={styles.sectionHeading}>Device Information</h4>
                <div className={styles.formGrid}>
                  <label>
                    <span>Fleet Group</span>
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
                    <span>Device Code (ไม่บังคับ)</span>
                    <input
                      value={form.deviceCode}
                      onChange={(event) => setForm({ ...form, deviceCode: event.target.value })}
                      placeholder="เว้นว่างได้ (Optional)"
                    />
                  </label>
                  <label>
                    <span>Device Name</span>
                    <input
                      value={form.deviceName}
                      onChange={(event) => setForm({ ...form, deviceName: event.target.value })}
                      placeholder="e.g. AMR01"
                    />
                  </label>
                  <label>
                    <span>IP Address</span>
                    <input
                      value={form.ipAddress}
                      onChange={(event) => setForm({ ...form, ipAddress: event.target.value })}
                      placeholder="e.g. 172.30.39.101"
                    />
                  </label>
                </div>

                {/* Auto Backup Toggle Switch */}
                <div
                  className={styles.switchContainer}
                  onClick={() => setForm((prev) => ({ ...prev, autoBackupEnabled: !prev.autoBackupEnabled }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setForm((prev) => ({ ...prev, autoBackupEnabled: !prev.autoBackupEnabled }));
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className={styles.switchInfo}>
                    <span className={styles.switchTitle}>Auto backup (สำรองข้อมูลอัตโนมัติ)</span>
                    <span className={styles.switchSubtitle}>
                      เปิดใช้งานการสำรองข้อมูลอัตโนมัติตามรอบเวลาสำหรับเครื่องนี้
                    </span>
                  </div>
                  <label className={styles.toggleSwitch} onClick={(e) => e.stopPropagation()}>
                    <input
                      checked={form.autoBackupEnabled}
                      onChange={(event) => setForm((prev) => ({ ...prev, autoBackupEnabled: event.target.checked }))}
                      type="checkbox"
                    />
                    <span className={styles.slider} />
                  </label>
                </div>
              </div>

              {/* SSH Connection Section */}
              <div className={styles.modalSection}>
                <div
                  className={styles.switchContainer}
                  onClick={() => setForm((prev) => ({ ...prev, useOwnCredentials: !prev.useOwnCredentials }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setForm((prev) => ({ ...prev, useOwnCredentials: !prev.useOwnCredentials }));
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className={styles.switchInfo}>
                    <span className={styles.switchTitle}>ตั้งค่า SSH login เฉพาะเครื่องนี้ (SSH Override)</span>
                    <span className={styles.switchSubtitle}>
                      เปิดใช้งานหากเครื่องนี้มี SSH Username, Password หรือ Port แยกต่างหากจากค่ากลางของระบบ
                    </span>
                  </div>
                  <label className={styles.toggleSwitch} onClick={(e) => e.stopPropagation()}>
                    <input
                      checked={form.useOwnCredentials}
                      onChange={(event) => setForm((prev) => ({ ...prev, useOwnCredentials: event.target.checked }))}
                      type="checkbox"
                    />
                    <span className={styles.slider} />
                  </label>
                </div>

                {form.useOwnCredentials ? (
                  <div className={styles.overrideFields}>
                    <label>
                      <span>SSH Username</span>
                      <input
                        value={form.sshUsername}
                        onChange={(event) => setForm({ ...form, sshUsername: event.target.value })}
                        placeholder="เช่น pi หรือ root"
                      />
                    </label>
                    <label>
                      <span>SSH Password{mode === "edit" && selectedDevice?.hasSshOverride ? " (เว้นว่างถ้าไม่เปลี่ยน)" : ""}</span>
                      <input
                        value={form.sshPassword}
                        onChange={(event) => setForm({ ...form, sshPassword: event.target.value })}
                        type="password"
                        placeholder="••••••••"
                      />
                    </label>
                    <label>
                      <span>SSH Port</span>
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        inputMode="numeric"
                        value={form.sshPort}
                        onChange={(event) => setForm({ ...form, sshPort: event.target.value })}
                        placeholder="22"
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              {/* Custom Backup Paths (Device-Specific) */}
              {mode === "edit" ? (
                <div className={styles.customPathCard}>
                  <div className={styles.customPathHeader}>
                    <div>
                      <h4 className={styles.sectionHeading}>Backup path เฉพาะเครื่องนี้ (Device-Specific)</h4>
                      <p className={styles.hint}>
                        ระบุโฟลเดอร์หรือไฟล์บนเครื่องนี้ที่ต้องการสำรองข้อมูลเพิ่มเติม (ใช้แทนหรือเสริมจาก Path กลางของระบบ)
                      </p>
                    </div>
                  </div>

                  {devicePathsLoading ? (
                    <p className={styles.hint}>กำลังโหลดรายการ Path...</p>
                  ) : null}

                  {devicePaths.length ? (
                    <div className={styles.selectedPathList}>
                      {devicePaths.map((target) => (
                        <button
                          key={target.path}
                          onClick={() => removeDevicePath(target.path)}
                          title="คลิกเพื่อลบ Path นี้"
                          type="button"
                        >
                          <span>{target.label ? `${target.label}: ` : ""}{target.path}</span>
                          <b>×</b>
                        </button>
                      ))}
                    </div>
                  ) : !devicePathsLoading ? (
                    <div className={styles.emptyPathNotice}>
                      <span>ยังไม่มี Path เฉพาะเครื่อง — ระบบจะใช้ Path กลางของกลุ่มอุปกรณ์แทน</span>
                    </div>
                  ) : null}

                  <div className={styles.addPathBox}>
                    <div className={styles.addPathFields}>
                      <label className={styles.pathField}>
                        <span>Path บนเครื่อง (Remote Path) <b className={styles.reqStar}>*</b></span>
                        <input
                          value={newDevicePath}
                          onChange={(event) => setNewDevicePath(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void addDevicePath();
                            }
                          }}
                          placeholder="เช่น /home/user/backup-data หรือ /opt/ros/data"
                        />
                      </label>
                      <label className={styles.labelField}>
                        <span>ชื่อกำกับ (Label - ไม่บังคับ)</span>
                        <input
                          value={newDevicePathLabel}
                          onChange={(event) => setNewDevicePathLabel(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void addDevicePath();
                            }
                          }}
                          placeholder="เช่น App Config"
                        />
                      </label>
                    </div>
                    <button
                      className={styles.addPathBtn}
                      disabled={!newDevicePath.trim()}
                      onClick={() => void addDevicePath()}
                      type="button"
                    >
                      <PlusIcon className={styles.miniPlus} />
                      เพิ่ม Path
                    </button>
                  </div>
                </div>
              ) : null}

              {error ? <p className={styles.formError}>{error}</p> : null}
            </div>

            <div className={styles.modalActions}>
              {mode === "edit" && selectedDevice ? (
                <button
                  className={styles.deleteDeviceBtn}
                  onClick={() => setPendingDeleteDevice(selectedDevice)}
                  disabled={saving}
                  title="Delete this device"
                  type="button"
                >
                  <DeleteIcon className={styles.miniIcon} />
                  ลบอุปกรณ์
                </button>
              ) : null}
              <button onClick={closeModal} type="button">Cancel</button>
              <button onClick={submitForm} disabled={saving} type="button">
                {saving ? "Saving..." : mode === "add" ? "Add Device" : "Save Changes"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {/* File Browser & Manual Backup Modal */}
      {actionMode ? (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`${actionMode} device`}>
          <button className={styles.backdrop} onClick={closeModal} aria-label="Close device action" type="button" />
          <section className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <p>{selectedDevice?.name} ({selectedDevice?.ip})</p>
                <h2>{actionMode === "browse" ? "Remote File Browser" : `Run Backup: ${selectedDevice?.name}`}</h2>
              </div>
              <button className={styles.closeButton} onClick={closeModal} aria-label="Close" type="button">
                ×
              </button>
            </div>

            {actionMode === "browse" ? (
              <div className={styles.modalScrollBody}>
                <div className={styles.browserToolbar}>
                  <button
                    className={styles.parentDirBtn}
                    disabled={filesLoading || remotePath === "/" || !remotePath}
                    onClick={navigateToParent}
                    title="Go to parent directory"
                    type="button"
                  >
                    <ArrowUpIcon className={styles.miniIcon} />
                    Parent directory
                  </button>
                  <div className={styles.pathInputWrapper}>
                    <label className={styles.srOnly} htmlFor="remote-path-input">Remote Path</label>
                    <input
                      id="remote-path-input"
                      value={remotePath}
                      onChange={(event) => setRemotePath(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && selectedDevice?.id) {
                          event.preventDefault();
                          void loadRemoteFiles(selectedDevice.id, remotePath);
                        }
                      }}
                      placeholder="/home"
                    />
                  </div>
                  <button
                    className={styles.primaryActionBtn}
                    disabled={filesLoading || !selectedDevice?.id}
                    onClick={() => selectedDevice?.id && loadRemoteFiles(selectedDevice.id, remotePath)}
                    type="button"
                  >
                    {filesLoading ? "Loading..." : "Go"}
                  </button>
                </div>

                <div className={styles.fileList}>
                  {remoteFiles.length ? (
                    remoteFiles.map((file) => (
                      <article
                        className={file.file_type === "directory" ? styles.browseFolder : styles.browseFile}
                        key={file.path}
                        onClick={() => {
                          if (file.file_type === "directory") void openBrowsePath(file.path);
                        }}
                        onKeyDown={(event) => {
                          if (file.file_type === "directory" && (event.key === "Enter" || event.key === " ")) {
                            event.preventDefault();
                            void openBrowsePath(file.path);
                          }
                        }}
                        role={file.file_type === "directory" ? "button" : undefined}
                        tabIndex={file.file_type === "directory" ? 0 : undefined}
                      >
                        <div className={styles.fileLeading}>
                          {file.file_type === "directory" ? (
                            <FolderIcon className={styles.dirIcon} />
                          ) : (
                            <FileTextIcon className={styles.docIcon} />
                          )}
                          <div className={styles.fileMeta}>
                            <strong>{file.name}</strong>
                            <span>{file.path}</span>
                          </div>
                        </div>
                        <div className={styles.fileTrailing}>
                          {file.file_type === "directory" ? (
                            <>
                              <span className={styles.dirBadge}>Directory</span>
                              <ChevronRightIcon className={styles.chevronIcon} />
                            </>
                          ) : (
                            <b className={styles.sizeBadge}>{formatBytes(file.size_bytes)}</b>
                          )}
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className={styles.emptyListText}>{filesLoading ? "Reading directory..." : "Directory is empty"}</p>
                  )}
                </div>
              </div>
            ) : (
              <div className={styles.modalScrollBody}>
                <div className={styles.actionFormTop}>
                  <label className={styles.fieldLabel}>
                    <span>ชื่อ Backup (ไม่บังคับ)</span>
                    <input
                      value={backupName}
                      onChange={(event) => setBackupName(event.target.value)}
                      placeholder="เช่น pre_maintenance_snapshot (เว้นว่างเพื่อใช้เวลาปัจจุบัน)"
                    />
                  </label>
                  <div className={styles.backupSelectionSummary}>
                    <strong>{selectedPaths.length + (includeDatabase ? 1 : 0)}</strong>
                    <span>targets selected</span>
                  </div>
                </div>

                <div className={styles.modalSection}>
                  <h4 className={styles.sectionHeading}>Select Backup Targets</h4>
                  <div className={styles.targetList}>
                    {backupTargets.length ? (
                      backupTargets.map((target) => (
                        <label className={styles.targetRow} key={`${target.backup_api}:${target.path}:${target.key}`}>
                          <input
                            checked={target.backup_api === "robot_db" ? includeDatabase : selectedPaths.includes(target.path)}
                            onChange={() => {
                              if (target.backup_api === "robot_db") setIncludeDatabase((current) => !current);
                              else toggleBackupPath(target.path);
                            }}
                            type="checkbox"
                          />
                          <div className={styles.targetIconBox}>
                            {target.backup_api === "robot_db" ? (
                              <DatabaseIcon className={styles.dbIcon} />
                            ) : (
                              <FolderIcon className={styles.folderIcon} />
                            )}
                          </div>
                          <div className={styles.targetInfo}>
                            <strong>{target.label}</strong>
                            <span>{target.path}</span>
                          </div>
                          <span className={styles.targetKindBadge}>
                            {target.backup_api === "robot_db" ? "DB JSON" : target.target_type.toUpperCase()}
                          </span>
                          {target.browsable ? (
                            <button
                              className={styles.targetBrowseBtn}
                              onClick={(event) => {
                                event.preventDefault();
                                openBackupTargetPath(target.path);
                              }}
                              type="button"
                            >
                              Browse
                            </button>
                          ) : null}
                        </label>
                      ))
                    ) : (
                      <p className={styles.emptyText}>No backup targets configured</p>
                    )}
                  </div>
                </div>

                <div className={styles.modalSection}>
                  <h4 className={styles.sectionHeading}>เพิ่ม Path กำหนดเอง (Custom Target)</h4>
                  <div className={styles.addPathBox}>
                    <div className={styles.addPathFields}>
                      <label className={styles.pathField}>
                        <span>Remote Path บนเครื่อง <b className={styles.reqStar}>*</b></span>
                        <input
                          value={customBackupPath}
                          onChange={(event) => setCustomBackupPath(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void addCustomBackupPath();
                            }
                          }}
                          placeholder="เช่น /home/matrix/path/to/backup"
                        />
                      </label>
                      <label className={styles.labelField}>
                        <span>ชื่อกำกับ (Label - ไม่บังคับ)</span>
                        <input
                          value={customBackupPathLabel}
                          onChange={(event) => setCustomBackupPathLabel(event.target.value)}
                          placeholder="เช่น ROS Parameters"
                        />
                      </label>
                    </div>
                    <button className={styles.addPathBtn} onClick={() => void addCustomBackupPath()} type="button">
                      <PlusIcon className={styles.miniPlus} />
                      เพิ่ม Target
                    </button>
                  </div>
                </div>

                {selectedPaths.length ? (
                  <div className={styles.modalSection}>
                    <h4 className={styles.sectionHeading}>Selected Paths ({selectedPaths.length})</h4>
                    <div className={styles.selectedPathList}>
                      {selectedPaths.map((path) => (
                        <button key={path} onClick={() => toggleBackupPath(path)} type="button">
                          <span>{path}</span>
                          <b>×</b>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {openedPath ? (
                  <div className={styles.browser}>
                    <div className={styles.browserHeader}>
                      <strong>Browsing: {openedPath}</strong>
                      <button onClick={() => setOpenedPath("")} type="button">Close Browser</button>
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
                      <p className={styles.emptyText}>{filesLoading ? "Loading files..." : "No files found"}</p>
                    )}
                  </div>
                ) : null}

                {/* ZIP compression switch */}
                <div
                  className={styles.switchContainer}
                  onClick={() => setZipOutput(!zipOutput)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setZipOutput((prev) => !prev);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className={styles.switchInfo}>
                    <span className={styles.switchTitle}>บีบอัดไฟล์เป็น .zip (Zip Compression)</span>
                    <span className={styles.switchSubtitle}>
                      รวมไฟล์สำรองทั้งหมดเป็นไฟล์ .zip ไฟล์เดียวเพื่อให้ง่ายต่อการดาวน์โหลดและจัดเก็บ
                    </span>
                  </div>
                  <label className={styles.toggleSwitch} onClick={(e) => e.stopPropagation()}>
                    <input
                      checked={zipOutput}
                      onChange={(event) => setZipOutput(event.target.checked)}
                      type="checkbox"
                    />
                    <span className={styles.slider} />
                  </label>
                </div>

                {backupResult ? (
                  <div className={styles.resultBox}>
                    <strong>{backupResult.message}</strong>
                    <span>{backupResult.local_path}</span>
                  </div>
                ) : null}
              </div>
            )}

            {error ? <p className={styles.formError}>{error}</p> : null}

            <div className={styles.modalActions}>
              <button onClick={closeModal} type="button">Close</button>
              {actionMode === "backup" ? (
                <button className={styles.primaryActionBtn} onClick={submitBackup} disabled={saving} type="button">
                  <BackupIcon className={styles.miniIcon} />
                  {saving ? "Backing up..." : "Start Backup"}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {pendingDeleteDevice ? (
        <div className={styles.confirmOverlay} role="dialog" aria-modal="true" aria-labelledby="delete-device-title">
          <button
            className={styles.confirmBackdrop}
            onClick={() => !saving && setPendingDeleteDevice(null)}
            aria-label="Cancel delete"
            type="button"
          />
          <section className={styles.confirmDialog}>
            <h2 id="delete-device-title">Delete device?</h2>
            <p>
              This will delete <strong>{pendingDeleteDevice.name}</strong> and its device-specific backup paths.
            </p>
            <div className={styles.confirmActions}>
              <button onClick={() => setPendingDeleteDevice(null)} disabled={saving} type="button">Cancel</button>
              <button onClick={() => void confirmDeleteDevice()} disabled={saving} type="button">
                {saving ? "Deleting..." : "Delete device"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <BackupProgressModal {...backupProgress} onClose={handleCloseBackupProgress} />
    </>
  );
}

function buildCreatePayload(form: FormState): DeviceFormPayload {
  const groupId = Number(form.groupId);
  if (!groupId) {
    throw new Error("Please select a valid device group");
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
      throw new Error("Please fill in both SSH username and password for custom credentials");
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
  if (deviceCode !== original.code) payload.device_code = deviceCode;
  if (deviceName !== original.name) payload.device_name = deviceName;
  if (ipAddress !== original.ip) payload.ip_address = ipAddress;
  if (form.autoBackupEnabled !== original.autoBackupEnabled) payload.auto_backup_enabled = form.autoBackupEnabled;

  if (form.useOwnCredentials) {
    const username = form.sshUsername.trim();
    if (!username) {
      throw new Error("Please provide SSH username");
    }
    if (!original.hasSshOverride && !form.sshPassword) {
      throw new Error("Please provide SSH password for custom credentials");
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
