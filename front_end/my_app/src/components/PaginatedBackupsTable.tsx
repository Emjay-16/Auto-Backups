"use client";

import { useMemo, useState } from "react";
import type { Backup } from "@/lib/types";
import styles from "@/styles/pages/backups/backups.module.css";
import { StatusBadge } from "./StatusBadge";
import { PaginationControls } from "./PaginationControls";

const PAGE_SIZE = 10;

export function PaginatedBackupsTable({
  backups,
  onDelete,
  onOpen,
}: {
  backups: Backup[];
  onDelete?: (backup: Backup) => void;
  onOpen?: (backup: Backup) => void;
}) {
  const [page, setPage] = useState(0);
  const visibleBackups = useMemo(
    () => backups.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [backups, page],
  );

  return (
    <>
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
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visibleBackups.map((backup) => (
            <tr key={backup.name}>
              <td>
                <button className={styles.nameButton} disabled={!backup.id} onClick={() => onOpen?.(backup)}>
                  {backup.name}
                </button>
              </td>
              <td>{backup.device}</td>
              <td>
                <span className={styles.type}>{backup.type}</span>
              </td>
              <td>{backup.files}</td>
              <td>{backup.size}</td>
              <td>
                <StatusBadge status={backup.status} />
              </td>
              <td>{backup.createdAt}</td>
              <td className={styles.actionsCell}>
                <div className={styles.actions}>
                  <button disabled={!backup.id} onClick={() => onOpen?.(backup)} title="Details and download">▤</button>
                  <button disabled={!backup.id} onClick={() => onDelete?.(backup)} title="Delete">×</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <PaginationControls
        page={page}
        pageSize={PAGE_SIZE}
        total={backups.length}
        onPrevious={() => setPage((current) => Math.max(0, current - 1))}
        onNext={() => setPage((current) => Math.min(Math.ceil(backups.length / PAGE_SIZE) - 1, current + 1))}
      />
    </>
  );
}
