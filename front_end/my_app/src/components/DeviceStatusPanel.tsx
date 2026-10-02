"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import type { Backup, Device } from "@/lib/types";
import { RobotGroupBadge, robotGroupTone } from "./RobotGroupBadge";
import styles from "@/styles/components/DeviceStatusPanel.module.css";

type DeviceStatusPanelProps = {
  devices: Device[];
  backups: Backup[];
};

function parseSizeToBytes(sizeStr: string): number {
  if (!sizeStr) return 0;
  const match = sizeStr.trim().match(/^([\d.]+)\s*([a-zA-Z]+)?$/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = (match[2] || "B").toUpperCase();
  if (unit === "KB") return num * 1024;
  if (unit === "MB") return num * 1024 * 1024;
  if (unit === "GB") return num * 1024 * 1024 * 1024;
  if (unit === "TB") return num * 1024 * 1024 * 1024 * 1024;
  return num;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function DeviceStatusPanel({ devices, backups }: DeviceStatusPanelProps) {
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [modalSearch, setModalSearch] = useState("");
  const [mounted, setMounted] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (selectedDevice) {
      closeButtonRef.current?.focus();
    } else {
      setModalSearch("");
    }
  }, [selectedDevice]);

  // Handle escape key to close modal
  useEffect(() => {
    if (!selectedDevice) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedDevice(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedDevice]);

  const getDeviceBackups = (device: Device): Backup[] => {
    return backups
      .filter(
        (b) =>
          b.deviceId != null
            ? b.deviceId === device.id
            : Boolean(b.device && device.name && b.device.trim().toLowerCase() === device.name.trim().toLowerCase())
      )
      .sort((a, b) => {
        const timeA = new Date(a.createdAtRaw || a.createdAt).getTime();
        const timeB = new Date(b.createdAtRaw || b.createdAt).getTime();
        return (Number.isNaN(timeB) ? 0 : timeB) - (Number.isNaN(timeA) ? 0 : timeA);
      });
  };

  const selectedDeviceBackups = selectedDevice ? getDeviceBackups(selectedDevice) : [];
  const filteredModalBackups = selectedDeviceBackups.filter(
    (b) =>
      b.name.toLowerCase().includes(modalSearch.toLowerCase()) ||
      b.type.toLowerCase().includes(modalSearch.toLowerCase()) ||
      b.createdAt.toLowerCase().includes(modalSearch.toLowerCase())
  );

  const selectedDeviceStorage = selectedDeviceBackups.reduce(
    (sum, b) => sum + parseSizeToBytes(b.size),
    0
  );
  const selectedDeviceSuccessCount = selectedDeviceBackups.filter((b) => b.status === "success").length;
  const selectedDeviceFailedCount = selectedDeviceBackups.filter((b) => b.status === "failed").length;

  return (
    <>
      <div className={styles.grid}>
        {devices.length > 0 ? (
          devices.map((device, index) => {
            const deviceKey = String(device.id || device.ip || device.code || `${device.name}-${index}`);
            const devBackups = getDeviceBackups(device);
            const devStorageBytes = devBackups.reduce(
              (sum, b) => sum + parseSizeToBytes(b.size),
              0
            );

            return (
              <button
                type="button"
                className={`${styles.card} ${styles[robotGroupTone(device.group)]}`}
                key={deviceKey}
                onClick={() => setSelectedDevice(device)}
                title={`คลิกเพื่อดูรายการชุดสำรองข้อมูลของ ${device.name}`}
              >
                <div className={styles.cardHeader}>
                  <div className={styles.deviceIdentity}>
                    <RobotGroupBadge group={device.group} variant="avatar" />
                    <div className={styles.deviceInfo}>
                      <strong className={styles.deviceName}>{device.name}</strong>
                      <span className={styles.deviceIp}>{device.ip}</span>
                    </div>
                  </div>
                  {device.status === "online" ? (
                    <span className={styles.onlineBadge}>
                      <span className={styles.pulseDot} />
                      ออนไลน์
                    </span>
                  ) : (
                    <span className={styles.offlineBadge}>
                      ออฟไลน์
                    </span>
                  )}
                </div>

                <div className={styles.backupTextRow}>
                  {devBackups.length > 0 ? (
                    <span className={styles.backupText}>
                      <strong>มี {devBackups.length} ชุดสำรอง</strong>
                      <span className={styles.backupSizeText}> · {formatBytes(devStorageBytes)}</span>
                    </span>
                  ) : (
                    <span className={styles.noBackupText}>ยังไม่มีชุดสำรอง</span>
                  )}
                </div>

                <div className={styles.cardFooter}>
                  <span className={styles.lastSeenLabel}>
                    เชื่อมต่อล่าสุด: <strong>{device.lastSeen || "-"}</strong>
                  </span>
                  <span className={styles.deviceGroupTag}>
                    {device.group}
                  </span>
                </div>
              </button>
            );
          })
        ) : (
          <div className={styles.emptyState}>
            <strong>ไม่พบอุปกรณ์ที่ออนไลน์</strong>
            <span>อุปกรณ์ที่เปิดใช้งานและเชื่อมต่อในเครือข่ายจะปรากฏขึ้นที่นี่โดยอัตโนมัติ</span>
          </div>
        )}
      </div>

      {/* Modal: แสดงรายการชุดสำรองข้อมูลของเครื่องที่เลือก */}
      {selectedDevice && mounted
        ? createPortal(
            <div
              className={styles.modalOverlay}
              role="dialog"
              aria-modal="true"
              aria-labelledby="device-backup-modal-title"
            >
              <div
                className={styles.modalBackdrop}
                onClick={() => setSelectedDevice(null)}
                aria-hidden="true"
              />
              <section className={styles.modalContent}>
                {/* Modal Header */}
                <div className={styles.modalHeader}>
                  <div className={styles.modalTitleBlock}>
                    <div className={styles.modalTitleTop}>
                      <h2 id="device-backup-modal-title">{selectedDevice.name}</h2>
                      <RobotGroupBadge group={selectedDevice.group} variant="badge" />
                      <span className={styles.onlinePill}>
                        <i aria-hidden="true" />
                        ออนไลน์
                      </span>
                    </div>
                    <p className={styles.modalSubtitle}>
                      IP: {selectedDevice.ip} · เชื่อมต่อล่าสุด: {selectedDevice.lastSeen || "-"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={styles.modalCloseBtn}
                    onClick={() => setSelectedDevice(null)}
                    ref={closeButtonRef}
                    aria-label="ปิดหน้าต่าง"
                  >
                    ×
                  </button>
                </div>

                {/* Modal Summary Bar */}
                <div className={styles.modalStatsBar}>
                  <div className={styles.modalStatItem}>
                    <span>ชุดสำรองทั้งหมด</span>
                    <strong className={styles.statHighlight}>
                      มี {selectedDeviceBackups.length} ชุดสำรอง
                    </strong>
                  </div>
                  <div className={styles.modalStatItem}>
                    <span>ขนาดรวม</span>
                    <strong>{formatBytes(selectedDeviceStorage)}</strong>
                  </div>
                  <div className={styles.modalStatItem}>
                    <span>สำเร็จ</span>
                    <strong className={styles.statSuccessText}>
                      {selectedDeviceSuccessCount} ชุด
                    </strong>
                  </div>
                  <div className={styles.modalStatItem}>
                    <span>ล้มเหลว</span>
                    <strong className={styles.statFailedText}>
                      {selectedDeviceFailedCount} ชุด
                    </strong>
                  </div>
                </div>

                {/* Search Bar */}
                <div className={styles.modalToolbar}>
                  <input
                    type="text"
                    className={styles.modalSearchInput}
                    placeholder="ค้นหาชื่อชุดสำรอง, ประเภท, หรือวันที่..."
                    value={modalSearch}
                    onChange={(e) => setModalSearch(e.target.value)}
                  />
                  {modalSearch ? (
                    <button
                      type="button"
                      className={styles.clearSearchBtn}
                      onClick={() => setModalSearch("")}
                    >
                      ล้างคำค้น
                    </button>
                  ) : null}
                </div>

                {/* List / Table of Backup Sets */}
                <div className={styles.modalTableWrapper}>
                  {filteredModalBackups.length > 0 ? (
                    <table className={styles.backupTable}>
                      <thead>
                        <tr>
                          <th>ชุดที่</th>
                          <th>ชื่อชุดสำรอง</th>
                          <th>ประเภท</th>
                          <th>จำนวนไฟล์</th>
                          <th>ขนาด</th>
                          <th>วันที่และเวลา</th>
                          <th>สถานะ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredModalBackups.map((b, idx) => (
                          <tr key={b.id || idx}>
                            <td className={styles.colIndex}>#{idx + 1}</td>
                            <td className={styles.colName}>
                              <strong>{b.name}</strong>
                            </td>
                            <td>{b.type || "Full"}</td>
                            <td>{b.files} ไฟล์</td>
                            <td>{b.size}</td>
                            <td className={styles.colDate}>{b.createdAt}</td>
                            <td>
                              <span
                                className={
                                  b.status === "success"
                                    ? styles.badgeSuccess
                                    : b.status === "failed"
                                    ? styles.badgeFailed
                                    : styles.badgePending
                                }
                              >
                                {b.status === "success"
                                  ? "สำเร็จ"
                                  : b.status === "failed"
                                  ? "ล้มเหลว"
                                  : b.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className={styles.modalEmptyState}>
                      <p>
                        {modalSearch
                          ? `ไม่พบชุดสำรองที่ตรงกับคำค้น "${modalSearch}"`
                          : "อุปกรณ์นี้ยังไม่มีชุดสำรองข้อมูลในระบบ"}
                      </p>
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className={styles.modalFooter}>
                  <Link
                    href={`/backups?q=${encodeURIComponent(selectedDevice.name)}`}
                    className={styles.allBackupsLink}
                  >
                    ดูในหน้ารายการสำรองข้อมูลทั้งหมด
                  </Link>
                  <button
                    type="button"
                    className={styles.modalCancelBtn}
                    onClick={() => setSelectedDevice(null)}
                  >
                    ปิด
                  </button>
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
