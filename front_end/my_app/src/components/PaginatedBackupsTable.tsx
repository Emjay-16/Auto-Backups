"use client";

import { useEffect, useMemo, useState } from "react";
import type { Backup } from "@/lib/types";
import styles from "@/styles/pages/backups/backups.module.css";
import { ClockIcon, DeleteIcon, DetailsIcon, DownloadIcon, FileTextIcon } from "./ActionIcons";
import { PaginationControls } from "./PaginationControls";
import { StatusBadge } from "./StatusBadge";

const PAGE_SIZE = 10;

function getTypeBadgeClass(type: string): string {
  const lower = type.toLowerCase();
  if (lower.includes("db") || lower.includes("database")) return styles.typeDb;
  if (lower.includes("file")) return styles.typeFiles;
  return styles.typeCombined;
}

export function PaginatedBackupsTable({
  backups,
  onDelete,
  onOpen,
  onDownload,
}: {
  backups: Backup[];
  onDelete?: (backup: Backup) => void;
  onOpen?: (backup: Backup) => void;
  onDownload?: (backup: Backup) => void;
}) {
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [backups]);

  const totalPages = Math.max(1, Math.ceil(backups.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visibleBackups = useMemo(
    () => backups.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [backups, safePage],
  );

  return (
    <>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Backup Name</th>
              <th>Device</th>
              <th>Type</th>
              <th>Files</th>
              <th>Size</th>
              <th>Status</th>
              <th>Created</th>
              <th className={styles.actionsCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleBackups.length ? (
              visibleBackups.map((backup) => (
                <tr key={backup.id ?? `${backup.deviceId ?? backup.device}-${backup.name}-${backup.createdAtRaw ?? backup.createdAt}`}>
                  <td>
                    <button
                      className={styles.nameButton}
                      disabled={!backup.id}
                      onClick={() => onOpen?.(backup)}
                      type="button"
                    >
                      <FileTextIcon className={styles.nameIcon} />
                      <span>{backup.name}</span>
                    </button>
                  </td>
                  <td>
                    <div className={styles.deviceCell}>
                      <strong>{backup.device}</strong>
                    </div>
                  </td>
                  <td>
                    <span className={`${styles.typeBadge} ${getTypeBadgeClass(backup.type)}`}>
                      {backup.type}
                    </span>
                  </td>
                  <td className={styles.monoCell}>{backup.files}</td>
                  <td className={styles.monoCell}>{backup.size}</td>
                  <td>
                    <StatusBadge status={backup.status} />
                  </td>
                  <td>
                    <span className={styles.timeCell}>
                      <ClockIcon className={styles.timeIcon} />
                      <span>{backup.createdAt}</span>
                    </span>
                  </td>
                  <td className={styles.actionsCell}>
                    <div className={styles.actions}>
                      <button
                        className={styles.actionBtnDownload}
                        disabled={!backup.id}
                        onClick={() => onDownload?.(backup)}
                        title="ดาวน์โหลดไฟล์ .zip"
                        aria-label={`Download ${backup.name}`}
                        type="button"
                      >
                        <DownloadIcon />
                        <span>Download</span>
                      </button>
                      <button
                        className={styles.actionBtnDetails}
                        disabled={!backup.id}
                        onClick={() => onOpen?.(backup)}
                        title="ดูรายละเอียดไฟล์สำรอง"
                        aria-label={`Open ${backup.name}`}
                        type="button"
                      >
                        <DetailsIcon />
                        <span>Details</span>
                      </button>
                      <button
                        className={styles.actionBtnDelete}
                        disabled={!backup.id}
                        onClick={() => onDelete?.(backup)}
                        title="Delete backup"
                        aria-label={`Delete ${backup.name}`}
                        type="button"
                      >
                        <DeleteIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className={styles.emptyTableCell} colSpan={8}>
                  <strong>ไม่พบรายการสำรองข้อมูล</strong>
                  <span>สร้างการสำรองข้อมูลใหม่ หรือปรับเปลี่ยนเงื่อนไขการค้นหา</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PaginationControls
        page={safePage}
        pageSize={PAGE_SIZE}
        total={backups.length}
        onPrevious={() => setPage((current) => Math.max(0, current - 1))}
        onNext={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
      />
    </>
  );
}
