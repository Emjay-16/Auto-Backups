"use client";

import type { BackupProgressInfo, BackupRunResult } from "@/lib/api";
import type { BackupProgressStatus } from "./BackupProgressModal";
import styles from "@/styles/components/BackupMiniWidget.module.css";

export type BackupMiniWidgetProps = {
  status: BackupProgressStatus;
  deviceName?: string;
  backupName?: string;
  result?: BackupRunResult | null;
  errorMessage?: string;
  progressInfo?: BackupProgressInfo | null;
  isCancelling?: boolean;
  onMaximize: () => void;
  onCancel?: () => void;
  onClose: () => void;
};

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  const remainingSec = sec % 60;
  return `${mins}m ${remainingSec}s`;
}

export function BackupMiniWidget({
  status,
  deviceName,
  backupName,
  result,
  errorMessage,
  progressInfo,
  isCancelling = false,
  onMaximize,
  onCancel,
  onClose,
}: BackupMiniWidgetProps) {
  const displayDevice = result?.device_name || deviceName || "Device";
  const displayBackup = result?.backup_name || backupName || "-";

  const overallPercent = progressInfo?.overall_percent ?? 0;
  const currentFile = progressInfo?.current_file || "";
  const speedKb = progressInfo?.speed_kb_sec ?? 0;
  const elapsed = progressInfo?.elapsed_seconds ?? 0;

  return (
    <aside
      className={styles.miniWidget}
      aria-label="การสำรองข้อมูลในพื้นหลัง"
      role="region"
    >
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span
            className={`${styles.statusDot} ${
              status === "success"
                ? styles.statusDotSuccess
                : status === "error" || status === "cancelled"
                ? styles.statusDotError
                : ""
            }`}
            aria-hidden="true"
          />
          <div className={styles.titleGroup}>
            <span className={styles.deviceName}>{displayDevice}</span>
            {displayBackup && displayBackup !== "-" ? (
              <span className={styles.backupName}>Backup: {displayBackup}</span>
            ) : null}
          </div>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={onMaximize}
            title="ขยายเป็นหน้าต่างเต็ม"
            aria-label="ขยายเป็นหน้าต่างเต็ม"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
            <span>ขยาย</span>
          </button>

          {status === "loading" && onCancel ? (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={onCancel}
              disabled={isCancelling}
              title="ยกเลิกการสำรองข้อมูล"
              aria-label="ยกเลิก"
            >
              {isCancelling ? "..." : "ยกเลิก"}
            </button>
          ) : (
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              title="ปิดแท็บ"
              aria-label="ปิด"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div
        className={styles.body}
        onClick={onMaximize}
        title="คลิกเพื่อเปิดหน้าต่างเต็ม"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onMaximize();
          }
        }}
      >
        {status === "loading" ? (
          <>
            <div className={styles.progressRow}>
              <span className={styles.progressLabel}>
                กำลังสำรองข้อมูล
                {progressInfo?.total_files_estimate
                  ? ` (${Math.min(
                      progressInfo.file_index || 1,
                      progressInfo.total_files_estimate
                    )}/${progressInfo.total_files_estimate})`
                  : ""}
              </span>
              <span className={styles.progressPercent}>
                {overallPercent.toFixed(0)}%
              </span>
            </div>

            <div className={styles.progressBarTrack}>
              <div
                className={styles.progressBarFill}
                style={{
                  width: `${Math.min(100, Math.max(0, overallPercent))}%`,
                }}
              />
            </div>

            <div className={styles.fileRow}>
              <svg
                className={styles.fileIcon}
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className={styles.fileName}>
                {currentFile || "กำลังเชื่อมต่อ SSH..."}
              </span>
            </div>

            <div className={styles.statsRow}>
              <span>
                ความเร็ว:{" "}
                {speedKb > 0
                  ? speedKb >= 1024
                    ? `${(speedKb / 1024).toFixed(1)} MB/s`
                    : `${speedKb.toFixed(0)} KB/s`
                  : "กำลังคำนวณ..."}
              </span>
              <span>ใช้เวลา: {formatElapsed(elapsed)}</span>
            </div>
          </>
        ) : status === "success" ? (
          <div className={styles.successBody}>
            <div className={styles.successHeader}>
              <svg
                width="16"
                height="16"
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
              <span>สำรองข้อมูลเสร็จสิ้น! (100%)</span>
            </div>
            {result ? (
              <div className={styles.successMeta}>
                {result.total_file} ไฟล์ ·{" "}
                {typeof result.total_size_mb === "number"
                  ? result.total_size_mb.toFixed(2)
                  : result.total_size_mb}{" "}
                MB
              </div>
            ) : null}
            <div className={styles.successActions} onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={styles.viewSummaryBtn}
                onClick={onMaximize}
              >
                ดูสรุปผล
              </button>
              <button
                type="button"
                className={styles.dismissBtn}
                onClick={onClose}
              >
                ปิด
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.errorBody}>
            <div className={styles.errorHeader}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>
                {status === "cancelled"
                  ? "การสำรองข้อมูลถูกยกเลิก"
                  : "สำรองข้อมูลไม่สำเร็จ"}
              </span>
            </div>
            <div className={styles.errorMessage}>
              {errorMessage || "เกิดข้อผิดพลาดในการสำรองข้อมูล"}
            </div>
            <div className={styles.successActions} onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={styles.viewSummaryBtn}
                onClick={onMaximize}
              >
                ดูรายละเอียด
              </button>
              <button
                type="button"
                className={styles.dismissBtn}
                onClick={onClose}
              >
                ปิด
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

