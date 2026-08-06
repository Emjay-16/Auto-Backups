"use client";

import { useMemo, useState } from "react";
import type { Backup } from "@/lib/types";
import styles from "@/styles/pages/backups/backups.module.css";
import { StatusBadge } from "./StatusBadge";
import { PaginationControls } from "./PaginationControls";
import { DeleteIcon, DetailsIcon } from "./ActionIcons";

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
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleBackups.length ? visibleBackups.map((backup) => (
              <tr key={backup.id ?? `${backup.device}-${backup.name}-${backup.createdAtRaw ?? backup.createdAt}`}>
                <td>
                  <button className={styles.nameButton} disabled={!backup.id} onClick={() => onOpen?.(backup)} type="button">
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
                    <button disabled={!backup.id} onClick={() => onOpen?.(backup)} title="Details and download" aria-label={`Open ${backup.name}`} type="button"><DetailsIcon /></button>
                    <button className={styles.dangerAction} disabled={!backup.id} onClick={() => onDelete?.(backup)} title="Delete" aria-label={`Delete ${backup.name}`} type="button"><DeleteIcon /></button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td className={styles.emptyTableCell} colSpan={8}>
                  <strong>No backups found</strong>
                  <span>Create a new backup or adjust your search.</span>
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
        onPrevious={() => setPage((current) => Math.max(0, Math.min(current, totalPages - 1) - 1))}
        onNext={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
      />
    </>
  );
}
