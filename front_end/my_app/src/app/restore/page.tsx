"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Panel } from "@/components/Panel";
import { PaginationControls } from "@/components/PaginationControls";
import { useToast } from "@/components/ToastProvider";
import {
  getBackupDetail,
  getBackupsForUi,
  getDevicesForUi,
  restoreBackup,
  uploadFilesToDevice,
  getErrorMessage,
  type BackupDetail,
  type BackupFileDetail,
  type RestoreRunResult,
  type UploadRunResult,
} from "@/lib/api";
import type { Backup, Device } from "@/lib/types";
import styles from "@/styles/pages/restore/restore.module.css";

interface FileGroup {
  groupKey: string;
  groupLabel: string;
  groupType: "database" | "zip" | "file";
  files: BackupFileDetail[];
  sharedTargetPath: string;
}

const BACKUP_PAGE_SIZE = 6;

export default function RestorePage() {
  const { data: session } = useSession();
  const { showToast } = useToast();
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [restoreMode, setRestoreMode] = useState<string>("overwrite");
  const [backups, setBackups] = useState<Backup[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedBackupId, setSelectedBackupId] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [backupDetail, setBackupDetail] = useState<BackupDetail | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [targetPaths, setTargetPaths] = useState<Record<number, string>>({});
  const [groupPaths, setGroupPaths] = useState<Record<string, string>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [fallbackTargetPath, setFallbackTargetPath] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [result, setResult] = useState<RestoreRunResult | UploadRunResult | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [backupPage, setBackupPage] = useState(0);
  const [restoreSearchQuery, setRestoreSearchQuery] = useState("");

  useEffect(() => {
    let mounted = true;
    const loadingId = window.setTimeout(() => {
      if (mounted) setIsLoadingList(true);
    }, 0);
    Promise.all([getBackupsForUi(), getDevicesForUi()])
      .then(([backupItems, deviceItems]) => {
        if (!mounted) return;
        setBackups(backupItems.filter((backup) => backup.id));
        setBackupPage(0);
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
        const message = getErrorMessage(errorResponse, "ไม่สามารถโหลดข้อมูลการกู้คืนได้");
        setError(message);
        showToast({ tone: "error", title: "โหลดข้อมูลการกู้คืนไม่สำเร็จ", message });
      })
      .finally(() => {
        if (mounted) setIsLoadingList(false);
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
      setIsLoadingDetail(true);
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
          showToast({
            tone: "error",
            title: "โหลดรายละเอียดไฟล์สำรองไม่สำเร็จ",
            message: getErrorMessage(errorResponse, "ไม่สามารถโหลดรายละเอียดของไฟล์สำรองนี้ได้"),
          });
        }
      })
      .finally(() => {
        if (mounted) setIsLoadingDetail(false);
      });

    return () => {
      mounted = false;
      window.clearTimeout(loadingId);
    };
  }, [restoreMode, selectedBackupId, showToast]);

  const selectedBackup = useMemo(
    () => backups.find((backup) => String(backup.id) === selectedBackupId),
    [backups, selectedBackupId],
  );

  const selectedDevice = useMemo(
    () => devices.find((device) => String(device.id) === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );

  const backupPageCount = Math.max(1, Math.ceil(backups.length / BACKUP_PAGE_SIZE));
  const safeBackupPage = Math.min(backupPage, backupPageCount - 1);
  const visibleBackups = useMemo(() => {
    const start = safeBackupPage * BACKUP_PAGE_SIZE;
    return backups.slice(start, start + BACKUP_PAGE_SIZE);
  }, [backups, safeBackupPage]);

  const sourceReady = restoreMode === "upload" ? uploadFiles.length > 0 : Boolean(selectedBackup);
  const targetReady = Boolean(selectedDeviceId);
  const filesReady = restoreMode === "upload" ? Boolean(fallbackTargetPath.trim()) : selectedFileIds.length > 0;
  const totalBackupFiles = backupDetail?.files.length ?? selectedBackup?.files ?? 0;
  const selectedFileCount = selectedFileIds.length;
  const allFilesSelected = totalBackupFiles > 0 && selectedFileCount === totalBackupFiles;

  const fileGroups = useMemo<FileGroup[]>(() => {
    if (!backupDetail) return [];
    const map = new Map<string, BackupFileDetail[]>();
    for (const file of backupDetail.files) {
      const key = getGroupKey(file);
      const list = map.get(key) ?? [];
      list.push(file);
      map.set(key, list);
    }
    return Array.from(map.entries()).map(([groupKey, files]) => {
      const rep = files[0];
      return {
        groupKey,
        groupLabel: getGroupLabel(rep),
        groupType: restoreFileKindLabel(rep) as FileGroup["groupType"],
        files,
        sharedTargetPath: getGroupDefaultPath(rep),
      };
    });
  }, [backupDetail]);

  const filteredFileGroups = useMemo(() => {
    if (!restoreSearchQuery.trim()) return fileGroups;
    const q = restoreSearchQuery.toLowerCase();
    return fileGroups
      .map((g) => ({
        ...g,
        files: g.files.filter(
          (f) =>
            f.file_name.toLowerCase().includes(q) ||
            (f.file_path ?? "").toLowerCase().includes(q) ||
            g.groupLabel.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.files.length > 0);
  }, [fileGroups, restoreSearchQuery]);

  async function submitRestore() {
    const backupId = Number(selectedBackupId);
    const deviceId = Number(selectedDeviceId);
    if (!backupId || !deviceId) {
      setError("กรุณาเลือกไฟล์สำรองและอุปกรณ์ปลายทาง");
      return;
    }
    if (!selectedFileIds.length) {
      setError("กรุณาเลือกไฟล์ที่ต้องการกู้คืนอย่างน้อย 1 ไฟล์");
      return;
    }

    setSaving(true);
    setError("");
    setResult(null);

    const items = (backupDetail?.files ?? [])
      .filter((file) => selectedFileIds.includes(file.backup_file_id))
      .map((file) => {
        const isDb = isLikelyDatabaseBackupFile(file);
        let finalTarget: string;
        if (isDb) {
          finalTarget = "";
        } else {
          const gKey = getGroupKey(file);
          const customGroup = groupPaths[gKey]?.trim();
          if (customGroup) {
            // __nodered__ and __udev__ groups store the full file path (e.g. .../flows.json),
            // NOT a directory — appending the filename would double it (.../flows.json/flows.json)
            const isFilePath = gKey === "__nodered__" || gKey === "__udev__";
            if (isZipBackupFile(file) || isFilePath) {
              finalTarget = customGroup;
            } else {
              const relUnderCategory =
                (gKey === MAPS_ROOT || gKey === SOUNDS_ROOT) && file.file_path
                  ? file.file_path.replace(/\\/g, "/").replace(new RegExp(`^.*?/(maps|sounds)/`), "")
                  : file.file_name;
              finalTarget = `${customGroup.replace(/\/$/, "")}/${relUnderCategory}`;
            }
          } else {
            const specificPath = targetPaths[file.backup_file_id]?.trim();
            finalTarget = specificPath || fallbackTargetPath.trim();
          }
        }
        return {
          backup_file_id: file.backup_file_id,
          target_path: finalTarget,
        };
      });

    try {
      const response = await restoreBackup(backupId, {
        restored_by: Number((session?.user as { id?: string | number })?.id ?? 1),
        device_id: deviceId,
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
      showToast({
        tone: "error",
        title: "การกู้คืนข้อมูลไม่สำเร็จ",
        message: getErrorMessage(errorResponse, "เกิดข้อผิดพลาดในการกู้คืนข้อมูลไปยังอุปกรณ์"),
      });
    } finally {
      setSaving(false);
    }
  }

  async function submitUpload() {
    const deviceId = Number(selectedDeviceId);
    if (!deviceId) {
      setError("กรุณาเลือกอุปกรณ์ที่ต้องการอัปโหลดไฟล์ไป");
      return;
    }
    if (!fallbackTargetPath.trim()) {
      setError("กรุณาระบุ Path ปลายทางบนอุปกรณ์");
      return;
    }
    if (!uploadFiles.length) {
      setError("กรุณาเลือกไฟล์ที่ต้องการอัปโหลดอย่างน้อย 1 ไฟล์");
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
      showToast({
        tone: "error",
        title: "การอัปโหลดไฟล์ไม่สำเร็จ",
        message: getErrorMessage(errorResponse, "เกิดข้อผิดพลาดในการอัปโหลดไฟล์ไปยังอุปกรณ์"),
      });
    } finally {
      setSaving(false);
    }
  }

  function toggleFile(fileId: number) {
    setSelectedFileIds((current) =>
      current.includes(fileId) ? current.filter((item) => item !== fileId) : [...current, fileId],
    );
  }

  function selectAllFiles() {
    if (!backupDetail) return;
    setSelectedFileIds(backupDetail.files.map((file) => file.backup_file_id));
  }

  function clearFileSelection() {
    setSelectedFileIds([]);
  }

  const steps =
    restoreMode === "upload"
      ? [
          { step: 1, title: "1. เลือกไฟล์", desc: "ไฟล์จากเครื่องนี้" },
          { step: 2, title: "2. เครื่องเป้าหมาย", desc: "เลือกอุปกรณ์และ Path" },
          { step: 3, title: "3. ยืนยันการอัปโหลด", desc: "ตรวจสอบและเริ่มส่งไฟล์" },
        ]
      : [
          { step: 1, title: "1. เลือกไฟล์สำรอง", desc: "เลือกจากประวัติ Backup" },
          { step: 2, title: "2. เครื่องเป้าหมาย", desc: "เลือกอุปกรณ์ปลายทาง" },
          { step: 3, title: "3. จัดการไฟล์และ Path", desc: "เลือกโฟลเดอร์ที่จะกู้คืน" },
          { step: 4, title: "4. ยืนยันการกู้คืน", desc: "ตรวจสอบความปลอดภัย" },
        ];

  return (
    <div className={styles.page}>
      <div className={styles.restoreBoard}>
        <main className={styles.restoreWorkspace}>
          {/* Header */}
          <section className={styles.restoreHeader}>
            <div>
              <p>ระบบกู้คืนข้อมูล</p>
              <h2>{restoreMode === "upload" ? "อัปโหลดไฟล์ไปยังอุปกรณ์" : "กู้คืนข้อมูลจากไฟล์สำรอง"}</h2>
            </div>
            <div className={styles.modeSwitch} aria-label="โหมดการกู้คืน">
              <button
                className={restoreMode !== "upload" ? styles.activeMode : ""}
                onClick={() => {
                  setRestoreMode("overwrite");
                  setCurrentStep(1);
                  setResult(null);
                  setError("");
                }}
                type="button"
              >
                จากไฟล์สำรอง
              </button>
              <button
                className={restoreMode === "upload" ? styles.activeMode : ""}
                onClick={() => {
                  setRestoreMode("upload");
                  setCurrentStep(1);
                  setResult(null);
                  setError("");
                }}
                type="button"
              >
                อัปโหลดไฟล์
              </button>
            </div>
          </section>

          {/* Stepper Progress Bar */}
          <nav className={styles.wizardStepper} aria-label="ขั้นตอนการกู้คืน">
            {steps.map((st, idx) => (
              <div key={st.step} style={{ display: "contents" }}>
                <button
                  type="button"
                  className={`${styles.stepItem} ${
                    currentStep === st.step ? styles.stepActive : currentStep > st.step ? styles.stepDone : ""
                  }`}
                  onClick={() => {
                    if (st.step < currentStep) {
                      setCurrentStep(st.step);
                    } else if (st.step === 2 && sourceReady) {
                      setCurrentStep(2);
                    } else if (st.step === 3 && sourceReady && targetReady) {
                      setCurrentStep(3);
                    } else if (st.step === 4 && sourceReady && targetReady && filesReady) {
                      setCurrentStep(4);
                    }
                  }}
                >
                  <span className={styles.stepNumber}>{currentStep > st.step ? "✓" : st.step}</span>
                  <div className={styles.stepTitle}>
                    <strong>{st.title}</strong>
                    <small>{st.desc}</small>
                  </div>
                </button>
                {idx < steps.length - 1 ? (
                  <div className={`${styles.stepLine} ${currentStep > st.step ? styles.stepLineActive : ""}`} />
                ) : null}
              </div>
            ))}
          </nav>

          {/* Step 1: Select Source / Backup */}
          {currentStep === 1 ? (
            <Panel title={restoreMode === "upload" ? "ขั้นตอนที่ 1: เลือกไฟล์จากคอมพิวเตอร์" : "ขั้นตอนที่ 1: เลือกไฟล์สำรองจากระบบ"}>
              {restoreMode === "upload" ? (
                <div className={styles.uploadSource}>
                  <label className={styles.uploadDropzone}>
                    <strong>เลือกไฟล์จากเครื่อง</strong>
                    <span>{uploadFiles.length ? `${uploadFiles.length} ไฟล์พร้อมอัปโหลด` : "คลิกเพื่อเลือกไฟล์จากคอมพิวเตอร์"}</span>
                    <input multiple type="file" onChange={(event) => setUploadFiles(Array.from(event.target.files ?? []))} />
                  </label>
                  {uploadFiles.length ? (
                    <div className={styles.uploadList}>
                      {uploadFiles.map((file) => (
                        <span key={`${file.name}-${file.size}-${file.lastModified}`}>{file.name} ({Number(file.size / (1024 * 1024)).toFixed(2)} MB)</span>
                      ))}
                    </div>
                  ) : null}
                  <div className={styles.wizardNav}>
                    <span />
                    <button
                      type="button"
                      className={styles.navNextBtn}
                      disabled={!uploadFiles.length}
                      onClick={() => setCurrentStep(2)}
                    >
                      เลือกเครื่องเป้าหมาย
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.libraryHeader}>
                    <div>
                      <strong>{backups.length}</strong>
                      <span>ชุดข้อมูลสำรองที่พร้อมใช้งาน</span>
                    </div>
                    <b>{selectedBackup ? `เลือกอยู่: ${selectedBackup.name}` : "กรุณาคลิกเลือกไฟล์สำรองด้านล่าง"}</b>
                  </div>

                  <div className={styles.snapshots}>
                    {visibleBackups.length ? (
                      visibleBackups.map((backup, index) => (
                        <button
                          className={`${styles.snapshot} ${String(backup.id) === selectedBackupId ? styles.selected : ""}`}
                          key={backup.id ?? `${backup.device}-${backup.name}-${backup.createdAtRaw ?? backup.createdAt}-${index}`}
                          onClick={() => {
                            setSelectedBackupId(String(backup.id ?? ""));
                            setSelectedDeviceId(backup.deviceId ? String(backup.deviceId) : "");
                          }}
                          type="button"
                        >
                          <span
                            aria-hidden="true"
                            className={`${styles.selectionCheck} ${String(backup.id) === selectedBackupId ? styles.checked : ""}`}
                          />
                          <div>
                            <strong>{backup.name}</strong>
                            <p>{backup.device} · {backup.files} file(s) · {backup.size} · {backup.createdAt}</p>
                          </div>
                          <b>{backup.type}</b>
                        </button>
                      ))
                    ) : (
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

                  <div className={styles.wizardNav}>
                    <span />
                    <button
                      type="button"
                      className={styles.navNextBtn}
                      disabled={!selectedBackup}
                      onClick={() => setCurrentStep(2)}
                    >
                      เลือกอุปกรณ์ปลายทาง
                    </button>
                  </div>
                </>
              )}
            </Panel>
          ) : null}

          {/* Step 2: Target Device */}
          {currentStep === 2 ? (
            <Panel title="ขั้นตอนที่ 2: เลือกอุปกรณ์เป้าหมาย (Destination Device)">
              <div className={styles.target}>
                {selectedBackup ? (
                  <div className={styles.selectedBackupCard}>
                    <span>ไฟล์สำรองที่เลือก</span>
                    <strong>{selectedBackup.name}</strong>
                    <small>สร้างจากเครื่อง: {selectedBackup.device} · {selectedBackup.files} file(s) · {selectedBackup.size}</small>
                  </div>
                ) : null}

                <div className={styles.deviceSelectorGrid}>
                  {devices.map((device) => {
                    const isSelected = String(device.id) === selectedDeviceId;
                    const isSource = selectedBackup?.deviceId != null
                      ? device.id === selectedBackup.deviceId
                      : device.name === selectedBackup?.device;
                    const isOnline = device.status === "online";

                    return (
                      <button
                        key={`${device.id}-${device.name}`}
                        type="button"
                        className={`${styles.deviceSelectCard} ${isSelected ? styles.deviceSelectCardSelected : ""}`}
                        onClick={() => setSelectedDeviceId(String(device.id))}
                      >
                        <div className={styles.deviceCardTop}>
                          <strong>{device.name}</strong>
                          <span className={`${styles.deviceStatusBadge} ${isOnline ? styles.statusOnline : styles.statusOffline}`}>
                            {isOnline ? "Online" : "Offline"}
                          </span>
                        </div>
                        <div className={styles.deviceCardDetail}>
                          <span>IP: {device.ip}</span>
                          {isSource ? <span className={styles.sourceBadge}>Source</span> : <span>{device.group}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {selectedDevice && selectedDevice.status === "offline" ? (
                  <div className={styles.offlineAlert}>
                    คำเตือน: เครื่อง <strong>{selectedDevice.name}</strong> กำลัง Offline อยู่ กรุณาตรวจสอบการเชื่อมต่อก่อนเริ่มกู้คืนข้อมูล
                  </div>
                ) : null}

                <label className={styles.fallbackPathLabel}>
                  Default target path (กำหนดเองหากต้องการ)
                  <input
                    value={fallbackTargetPath}
                    onChange={(event) => setFallbackTargetPath(event.target.value)}
                    placeholder="/remote/path/on/robot (เว้นว่างไว้เพื่อใช้ path เริ่มต้นของระบบ)"
                  />
                  <span className={styles.hint}>หากระบุ โฟลเดอร์ที่ไม่ได้กำหนด path แยกจะใช้ path นี้เป็นปลายทาง</span>
                </label>

                <div className={styles.wizardNav}>
                  <button type="button" className={styles.navPrevBtn} onClick={() => setCurrentStep(1)}>
                    ย้อนกลับ
                  </button>
                  <button
                    type="button"
                    className={styles.navNextBtn}
                    disabled={!selectedDeviceId || (restoreMode === "upload" && !fallbackTargetPath.trim())}
                    onClick={() => setCurrentStep(3)}
                  >
                    {restoreMode === "upload" ? "ตรวจสอบและยืนยัน" : "จัดการไฟล์และ Path"}
                  </button>
                </div>
              </div>
            </Panel>
          ) : null}

          {/* Step 3: Files & Path Mapping (in Backup Mode) OR Review in Upload Mode */}
          {currentStep === 3 && restoreMode === "upload" ? (
            <Panel title="ขั้นตอนที่ 3: ตรวจสอบและเริ่มอัปโหลดไฟล์">
              <div className={styles.reviewGrid}>
                <div className={styles.reviewBox}>
                  <span>ไฟล์ที่จะอัปโหลด</span>
                  <strong>{uploadFiles.length} file(s)</strong>
                  <small>เลือกจากคอมพิวเตอร์</small>
                </div>
                <div className={styles.reviewBox}>
                  <span>อุปกรณ์เป้าหมาย</span>
                  <strong>{selectedDevice?.name ?? "ไม่ได้เลือก"}</strong>
                  <small>IP: {selectedDevice?.ip ?? "-"} · Status: {selectedDevice?.status ?? "-"}</small>
                </div>
                <div className={styles.reviewBox}>
                  <span>โฟลเดอร์ปลายทาง</span>
                  <strong>{fallbackTargetPath}</strong>
                  <small>บนเครื่องปลายทาง</small>
                </div>
              </div>


              {error ? (
                <div className={`${styles.resultCard} ${styles.resultCardError}`}>
                  <span className={styles.resultCardTitle}>เกิดข้อผิดพลาด</span>
                  <span className={styles.resultCardDetail}>{error}</span>
                </div>
              ) : null}
              {result ? (
                <div className={`${styles.resultCard} ${styles.resultCardSuccess}`}>
                  <span className={styles.resultCardTitle}>อัปโหลดสำเร็จ</span>
                  <span className={styles.resultCardDetail}>{result.message} · {"total_file" in result ? result.total_file : 0} ไฟล์</span>
                </div>
              ) : null}

              <div className={styles.wizardNav}>
                <button type="button" className={styles.navPrevBtn} onClick={() => setCurrentStep(2)}>
                  ย้อนกลับ
                </button>
                <button
                  type="button"
                  className={styles.navNextBtn}
                  disabled={saving || !uploadFiles.length || !selectedDeviceId || !fallbackTargetPath.trim() || selectedDevice?.status === "offline"}
                  onClick={submitUpload}
                >
                  {saving
                    ? "กำลังอัปโหลด..."
                    : selectedDevice?.status === "offline"
                    ? "ไม่สามารถอัปโหลดได้ (อุปกรณ์ออฟไลน์)"
                    : "เริ่มอัปโหลดไฟล์ไปยังหุ่นยนต์"}
                </button>
              </div>
            </Panel>
          ) : null}

          {currentStep === 3 && restoreMode !== "upload" ? (
            <Panel title="ขั้นตอนที่ 3: จัดการไฟล์และโฟลเดอร์ที่จะกู้คืน">
              <div className={styles.fileToolbar}>
                <div>
                  <button type="button" onClick={selectAllFiles} disabled={!backupDetail || allFilesSelected}>
                    เลือกทั้งหมด
                  </button>
                  <button type="button" onClick={clearFileSelection} disabled={!selectedFileCount}>
                    ยกเลิก
                  </button>
                </div>
                <div className={styles.fileToolbarSearch}>
                  <input
                    type="text"
                    placeholder="ค้นหาไฟล์..."
                    value={restoreSearchQuery}
                    onChange={(e) => setRestoreSearchQuery(e.target.value)}
                  />
                </div>
                <span className={styles.fileToolbarCount}>{selectedFileCount} ไฟล์ · {filteredFileGroups.length} กลุ่ม</span>
              </div>

              <div className={styles.files}>
                {backupDetail ? (
                  filteredFileGroups.map((group) => {
                    const groupFileIds = group.files.map((f) => f.backup_file_id);
                    const selectedInGroup = groupFileIds.filter((id) => selectedFileIds.includes(id));
                    const allGroupSelected = selectedInGroup.length === groupFileIds.length;
                    const someGroupSelected = selectedInGroup.length > 0 && !allGroupSelected;
                    const isExpanded = expandedGroups.has(group.groupKey);
                    const hasMissing = group.files.some((f) => f.file_exists === false);
                    const currentGroupPath = groupPaths[group.groupKey] ?? group.sharedTargetPath;

                    return (
                      <article className={`${styles.groupRow} ${selectedInGroup.length > 0 ? styles.selectedFile : ""}`} key={group.groupKey}>
                        <div className={styles.groupHeader}>
                          <label className={styles.groupCheckLabel}>
                            <input
                              type="checkbox"
                              checked={allGroupSelected}
                              ref={(el) => {
                                if (el) el.indeterminate = someGroupSelected;
                              }}
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
                            onClick={() =>
                              setExpandedGroups((cur) => {
                                const next = new Set(cur);
                                next.has(group.groupKey) ? next.delete(group.groupKey) : next.add(group.groupKey);
                                return next;
                              })
                            }
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? "ซ่อนรายละเอียด" : "ดูรายชื่อไฟล์"}
                          </button>
                        </div>

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
                          </div>
                        ) : (
                          <div className={`${styles.groupPathRow} ${styles.databaseTarget}`}>
                            <span>Database restore</span>
                            <p>ใช้ค่า MySQL ของหุ่นตัวนี้ ไม่ต้องใส่ path ไฟล์</p>
                          </div>
                        )}

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
                                  <small>{file.file_size_mb != null ? `${Number(file.file_size_mb).toFixed(2)} MB` : "—"}</small>
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
                  })
                ) : (
                  <p className={styles.empty}>{isLoadingDetail ? "กำลังโหลดรายการไฟล์..." : "กรุณาเลือกชุดสำรองข้อมูล"}</p>
                )}
              </div>

              <div className={styles.wizardNav}>
                <button type="button" className={styles.navPrevBtn} onClick={() => setCurrentStep(2)}>
                  ย้อนกลับ
                </button>
                <button
                  type="button"
                  className={styles.navNextBtn}
                  disabled={!selectedFileCount}
                  onClick={() => setCurrentStep(4)}
                >
                  ตรวจสอบและยืนยัน ({selectedFileCount} ไฟล์)
                </button>
              </div>
            </Panel>
          ) : null}

          {/* Step 4: Review & Execute (Backup Mode) */}
          {currentStep === 4 && restoreMode !== "upload" ? (
            <Panel title="ขั้นตอนที่ 4: ตรวจสอบความถูกต้องและเริ่มการกู้คืน">
              <div className={styles.reviewGrid}>
                <div className={styles.reviewBox}>
                  <span>ไฟล์สำรองต้นฉบับ</span>
                  <strong>{selectedBackup?.name}</strong>
                  <small>สร้างเมื่อ: {selectedBackup?.createdAt} · ขนาด: {selectedBackup?.size}</small>
                </div>
                <div className={styles.reviewBox}>
                  <span>อุปกรณ์เป้าหมาย (Destination)</span>
                  <strong>{selectedDevice?.name}</strong>
                  <small>IP: {selectedDevice?.ip} · Status: {selectedDevice?.status}</small>
                </div>
                <div className={styles.reviewBox}>
                  <span>จำนวนไฟล์ที่เลือก</span>
                  <strong>{selectedFileCount} / {totalBackupFiles} ไฟล์</strong>
                  <small>{fileGroups.length} กลุ่มโฟลเดอร์</small>
                </div>
                <div className={styles.reviewBox}>
                  <span>กลยุทธ์การกู้คืน (Strategy)</span>
                  <strong>{restoreMode === "overwrite" ? "เขียนทับไฟล์เดิม (Overwrite)" : "สร้างไฟล์ใหม่/เปลี่ยนชื่อ (Rename)"}</strong>
                  <small>กู้คืนไปยังโฟลเดอร์ที่กำหนดในขั้นตอนที่ 3</small>
                </div>
              </div>

              <div className={styles.safetyNotice}>
                <strong>ข้อควรระวังเพื่อความปลอดภัย</strong>
                <p>ระบบจะส่งไฟล์และนำข้อมูลกลับเข้าไปยังเครื่อง <strong>{selectedDevice?.name}</strong> ทันที กรุณาตรวจสอบให้แน่ใจว่าอุปกรณ์พร้อมทำงาน</p>
              </div>

              {error ? (
                <div className={`${styles.resultCard} ${styles.resultCardError}`}>
                  <span className={styles.resultCardTitle}>เกิดข้อผิดพลาด</span>
                  <span className={styles.resultCardDetail}>{error}</span>
                </div>
              ) : null}
              {result ? (
                <div className={`${styles.resultCard} ${styles.resultCardSuccess}`}>
                  <span className={styles.resultCardTitle}>กู้คืนข้อมูลสำเร็จ</span>
                  <span className={styles.resultCardDetail}>{result.message} · {"total_file" in result ? result.total_file : 0} ไฟล์</span>
                </div>
              ) : null}

              <div className={styles.wizardNav}>
                <button type="button" className={styles.navPrevBtn} onClick={() => setCurrentStep(3)}>
                  ย้อนกลับ
                </button>
                <button
                  type="button"
                  className={styles.navNextBtn}
                  disabled={saving || !sourceReady || !targetReady || !filesReady || selectedDevice?.status === "offline"}
                  onClick={submitRestore}
                >
                  {saving
                    ? "กำลังกู้คืนข้อมูล..."
                    : selectedDevice?.status === "offline"
                    ? "ไม่สามารถกู้คืนได้ (อุปกรณ์ออฟไลน์)"
                    : "เริ่มการกู้คืนข้อมูล (Start Restore)"}
                </button>
              </div>
            </Panel>
          ) : null}
        </main>
      </div>
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

  if (lowerPath.includes("/maps/")) {
    const mapsIndex = lowerPath.lastIndexOf("/maps/");
    const rel = filePath.slice(mapsIndex + "/maps/".length);
    return `${mapsRoot}/${rel}`;
  }

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

const MAPS_ROOT = "/home/matrix/public_web/ist_web_release/writable/uploads/maps";
const SOUNDS_ROOT = "/home/matrix/public_web/ist_web_release/writable/uploads/sounds";

function getGroupKey(file: BackupFileDetail): string {
  if (isLikelyDatabaseBackupFile(file)) return "__database__";

  const target = inferRestoreTarget(file);
  if (!target) return "__other__";

  if (target === MAPS_ROOT || target.startsWith(MAPS_ROOT + "/")) return MAPS_ROOT;
  if (target === SOUNDS_ROOT || target.startsWith(SOUNDS_ROOT + "/")) return SOUNDS_ROOT;

  if (target === "/home/matrix/node-red-dev/node-red-user/flows.json") return "__nodered__";
  if (target === "/etc/udev/rules.d/matrix_robot.rules") return "__udev__";

  const slashIdx = target.lastIndexOf("/");
  return slashIdx > 0 ? target.slice(0, slashIdx) : target;
}

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

function getGroupDefaultPath(file: BackupFileDetail): string {
  const key = getGroupKey(file);
  if (key === "__database__" || key === "__other__") return "";
  if (key === "__nodered__") return "/home/matrix/node-red-dev/node-red-user/flows.json";
  if (key === "__udev__") return "/etc/udev/rules.d/matrix_robot.rules";
  return key;
}
