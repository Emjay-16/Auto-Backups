"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { BackupProgressInfo, BackupRunResult } from "@/lib/api";
import styles from "@/styles/components/BackupProgressModal.module.css";

export type BackupProgressStatus = "loading" | "success" | "error" | "cancelled";

export type BackupProgressModalProps = {
  isOpen: boolean;
  status: BackupProgressStatus;
  deviceName?: string;
  backupName?: string;
  targetCount?: number;
  result?: BackupRunResult | null;
  errorMessage?: string;
  progressInfo?: BackupProgressInfo | null;
  isCancelling?: boolean;
  onMinimize?: () => void;
  onCancel?: () => void;
  onClose: () => void;
};

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec} วินาที`;
  const mins = Math.floor(sec / 60);
  const remainingSec = sec % 60;
  return `${mins} นาที ${remainingSec} วินาที`;
}

export function BackupProgressModal({
  isOpen,
  status,
  deviceName,
  backupName,
  targetCount = 0,
  result,
  errorMessage,
  progressInfo,
  isCancelling = false,
  onMinimize,
  onCancel,
  onClose,
}: BackupProgressModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && status !== "loading") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, status, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  const displayDevice = result?.device_name || deviceName || "Device";
  const displayBackupName = result?.backup_name || backupName || "-";

  const overallPercent = progressInfo?.overall_percent ?? 0;
  const filePercent = progressInfo?.file_percent ?? 0;
  const currentFile = progressInfo?.current_file || "";
  const speedKb = progressInfo?.speed_kb_sec ?? 0;
  const elapsedSeconds = progressInfo?.elapsed_seconds ?? 0;

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="backup-progress-title"
    >
      <button
        className={styles.backdrop}
        onClick={() => {
          if (status !== "loading") {
            onClose();
          }
        }}
        aria-label="Backdrop"
        tabIndex={-1}
        type="button"
      />

      <section className={styles.modal}>
        {onMinimize ? (
          <div className={styles.modalTopBar}>
            <button
              type="button"
              className={styles.minimizeBtn}
              onClick={onMinimize}
              title="ย่อหน้าต่าง (สามารถดูหน้าอื่นได้ระหว่างกำลังสำรองข้อมูล)"
              aria-label="ย่อหน้าต่าง"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
              <span>ย่อหน้าต่าง (ดูหน้าอื่น)</span>
            </button>
          </div>
        ) : null}

        <div className={styles.content}>
          {status === "loading" ? (
            <>
              <div className={`${styles.iconWrapper} ${styles.loadingIcon}`}>
                <div className={styles.spinnerPulse} aria-hidden="true" />
                <div className={styles.spinnerRing} aria-hidden="true" />
                <svg
                  width="34"
                  height="34"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>

              <p className={`${styles.eyebrow} ${styles.loading}`}>
                กำลังดำเนินการ (เรียลไทม์)
              </p>
              <h3 id="backup-progress-title" className={styles.title}>
                กำลังสำรองข้อมูล...
              </h3>
              <p className={styles.description}>
                {progressInfo?.message || (
                  <>
                    ระบบกำลังเชื่อมต่อและคัดลอกไฟล์จาก <strong>{displayDevice}</strong> กรุณารอสักครู่
                  </>
                )}
              </p>

              {/* Real-time Progress Bar & Stats */}
              <div className={styles.progressSection}>
                <div className={styles.progressBlock}>
                  <div className={styles.progressHeader}>
                    <span className={styles.progressLabel}>
                      ความคืบหน้ารวม
                      {progressInfo?.total_files_estimate
                        ? ` (${Math.min(progressInfo.file_index || 1, progressInfo.total_files_estimate)}/${progressInfo.total_files_estimate})`
                        : ""}
                    </span>
                    <span className={styles.progressPercent}>
                      {overallPercent.toFixed(0)}%
                    </span>
                  </div>
                  <div className={styles.progressBarTrack}>
                    <div
                      className={styles.progressBarFill}
                      style={{ width: `${Math.min(100, Math.max(0, overallPercent))}%` }}
                    />
                  </div>
                </div>

                <div className={styles.progressBlock}>
                  <div className={styles.progressHeader}>
                    <span className={styles.progressLabel}>
                      <span>ไฟล์ปัจจุบัน:</span>
                      <span className={styles.currentFileTag}>{currentFile || "กำลังเชื่อมต่อ SSH..."}</span>
                    </span>
                    <span className={styles.progressPercent}>
                      {filePercent > 0 ? `${filePercent.toFixed(0)}%` : "0%"}
                    </span>
                  </div>
                  <div className={styles.fileProgressBarTrack}>
                    <div
                      className={styles.fileProgressBarFill}
                      style={{ width: `${Math.min(100, Math.max(0, filePercent))}%` }}
                    />
                  </div>
                </div>

                <div className={styles.statsGrid}>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>ความเร็วการถ่ายโอน</span>
                    <span className={styles.statValue}>
                      {speedKb > 0
                        ? speedKb >= 1024
                          ? `${(speedKb / 1024).toFixed(1)} MB/s`
                          : `${speedKb.toFixed(0)} KB/s`
                        : "กำลังคำนวณ..."}
                    </span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>เวลาที่ใช้</span>
                    <span className={styles.statValue}>
                      {formatElapsed(elapsedSeconds)}
                    </span>
                  </div>
                </div>
              </div>

              <div className={styles.infoCard}>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>อุปกรณ์ (Device):</span>
                  <span className={styles.infoValue}>{displayDevice}</span>
                </div>
                {backupName ? (
                  <div className={styles.infoRow}>
                    <span className={styles.infoLabel}>ชื่อ Backup:</span>
                    <span className={`${styles.infoValue} ${styles.highlightValue}`}>{backupName}</span>
                  </div>
                ) : null}
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>รายการที่เลือก:</span>
                  <span className={styles.infoValue}>
                    {targetCount > 0 ? `${targetCount} รายการ` : "เป้าหมายทั้งหมด"}
                  </span>
                </div>
              </div>

              <div className={styles.loadingTip}>
                <span className={styles.loadingDot} aria-hidden="true" />
                <span>กำลังถ่ายโอนไฟล์ผ่าน SFTP / SSH สามารถกดยกเลิกได้ด้านล่าง</span>
              </div>
            </>
          ) : status === "success" ? (
            <>
              <div className={`${styles.iconWrapper} ${styles.successIcon}`}>
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>

              <p className={`${styles.eyebrow} ${styles.success}`}>
                เสร็จสิ้น
              </p>
              <h3 id="backup-progress-title" className={styles.title}>
                สำรองข้อมูลเสร็จสิ้น!
              </h3>
              <p className={styles.description}>
                บันทึกข้อมูลของ <strong>{displayDevice}</strong> เรียบร้อยแล้ว
              </p>

              <div className={styles.infoCard}>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>ชื่อ Backup:</span>
                  <span className={`${styles.infoValue} ${styles.highlightValue}`}>{displayBackupName}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>อุปกรณ์:</span>
                  <span className={styles.infoValue}>
                    {displayDevice} {result?.ip_address ? `(${result.ip_address})` : ""}
                  </span>
                </div>
                {result ? (
                  <>
                    <div className={styles.infoRow}>
                      <span className={styles.infoLabel}>จำนวนไฟล์:</span>
                      <span className={styles.infoValue}>{result.total_file} ไฟล์</span>
                    </div>
                    <div className={styles.infoRow}>
                      <span className={styles.infoLabel}>ขนาดรวม:</span>
                      <span className={styles.infoValue}>
                        {typeof result.total_size_mb === "number"
                          ? result.total_size_mb.toFixed(2)
                          : result.total_size_mb}{" "}
                        MB
                      </span>
                    </div>
                    {result.local_path ? (
                      <div>
                        <span className={styles.infoLabel}>ตำแหน่งที่เก็บไฟล์:</span>
                        <div className={styles.pathBox}>{result.local_path}</div>
                      </div>
                    ) : null}
                    {result.zip_path ? (
                      <div>
                        <span className={styles.infoLabel}>ไฟล์ Zip:</span>
                        <div className={styles.pathBox}>{result.zip_path}</div>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            </>
          ) : status === "cancelled" ? (
            <>
              <div className={`${styles.iconWrapper} ${styles.cancelledIcon}`}>
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
              </div>

              <p className={`${styles.eyebrow} ${styles.cancelled}`}>
                ยกเลิกแล้ว
              </p>
              <h3 id="backup-progress-title" className={styles.title}>
                ยกเลิกการสำรองข้อมูล
              </h3>
              <p className={styles.description}>
                การสำรองข้อมูลสำหรับ <strong>{displayDevice}</strong> ถูกยกเลิกโดยผู้ใช้
              </p>

              <div className={styles.errorCard} style={{ background: "#fef8f0", borderColor: "rgba(245, 158, 11, 0.4)", color: "#b45309" }}>
                ระบบได้หยุดการถ่ายโอนไฟล์และทำความสะอาดไฟล์ชั่วคราวเรียบร้อยแล้ว
              </div>
            </>
          ) : (
            <>
              <div className={`${styles.iconWrapper} ${styles.errorIcon}`}>
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>

              <p className={`${styles.eyebrow} ${styles.error}`}>
                เกิดข้อผิดพลาด
              </p>
              <h3 id="backup-progress-title" className={styles.title}>
                สำรองข้อมูลไม่สำเร็จ
              </h3>
              <p className={styles.description}>
                ไม่สามารถสำรองข้อมูลสำหรับ <strong>{displayDevice}</strong> ได้
              </p>

              <div className={styles.errorCard}>
                {errorMessage || "เกิดข้อผิดพลาดในการเชื่อมต่อหรือถ่ายโอนข้อมูล"}
              </div>
            </>
          )}
        </div>

        {status === "loading" && onCancel ? (
          <div className={styles.footer}>
            <button
              className={styles.cancelBtn}
              onClick={onCancel}
              disabled={isCancelling}
              type="button"
            >
              {isCancelling ? "กำลังส่งคำขอยกเลิก..." : "✕ ยกเลิกการสำรองข้อมูล"}
            </button>
          </div>
        ) : status !== "loading" ? (
          <div className={styles.footer}>
            <button
              className={`${styles.primaryBtn} ${status === "success" ? styles.successBtn : ""}`}
              onClick={onClose}
              type="button"
            >
              {status === "success" ? "เสร็จสิ้น" : "ปิด"}
            </button>
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
