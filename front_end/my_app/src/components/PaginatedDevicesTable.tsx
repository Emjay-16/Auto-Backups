"use client";

import { useMemo, useState } from "react";
import type { Device } from "@/lib/types";
import styles from "@/styles/pages/devices/devices.module.css";
import { StatusBadge } from "./StatusBadge";
import { PaginationControls } from "./PaginationControls";
import {
  BackupIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  EditIcon,
  FolderIcon,
  RestoreIcon,
} from "./ActionIcons";
import { RobotGroupBadge } from "./RobotGroupBadge";

const PAGE_SIZE = 10;

export function PaginatedDevicesTable({
  devices,
  onBackup,
  onBrowse,
  onEdit,
  onDelete,
  onRestore,
}: {
  devices: Device[];
  onBackup?: (device: Device) => void;
  onBrowse?: (device: Device) => void;
  onEdit?: (device: Device) => void;
  onDelete?: (device: Device) => void;
  onRestore?: (device: Device) => void;
}) {
  const [page, setPage] = useState(0);
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(devices.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visibleDevices = useMemo(
    () => devices.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [devices, safePage],
  );

  async function copyToClipboard(ip: string) {
    try {
      await navigator.clipboard.writeText(ip);
      setCopiedIp(ip);
      setTimeout(() => setCopiedIp((cur) => (cur === ip ? null : cur)), 1800);
    } catch {
      // ignore
    }
  }

  return (
    <>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Device</th>
              <th>Fleet Group</th>
              <th>IP Address</th>
              <th>Status</th>
              <th>Last Seen</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleDevices.length ? (
              visibleDevices.map((device, index) => {
                const isCopied = copiedIp === device.ip;
                return (
                  <tr key={device.id || device.code || device.ip || `${device.name}-${index}`}>
                    <td className={styles.deviceCell}>
                      <div className={styles.deviceAvatarWrapper}>
                        <RobotGroupBadge group={device.group} variant="avatar" />
                        <span className={`${styles.statusPip} ${styles[device.status] ?? ""}`} />
                      </div>
                      <div className={styles.deviceMeta}>
                        <div className={styles.deviceNameRow}>
                          <strong className={styles.deviceName}>{device.name}</strong>
                          {device.code ? <span className={styles.deviceCode}>{device.code}</span> : null}
                        </div>
                        <div className={styles.deviceSubRow}>
                          <span
                            className={
                              device.autoBackupEnabled ? styles.autoBackupBadgeOn : styles.autoBackupBadgeOff
                            }
                          >
                            {device.autoBackupEnabled ? (
                              <>
                                <CheckIcon className={styles.miniCheckIcon} />
                                Auto backup
                              </>
                            ) : (
                              "Manual only"
                            )}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <RobotGroupBadge group={device.group} />
                    </td>
                    <td>
                      <button
                        className={styles.ipCopyButton}
                        onClick={() => copyToClipboard(device.ip)}
                        title="Click to copy IP"
                        type="button"
                      >
                        <span className={styles.monoIp}>{device.ip}</span>
                        {isCopied ? (
                          <span className={styles.copiedBadge}>Copied!</span>
                        ) : (
                          <CopyIcon className={styles.copyIcon} />
                        )}
                      </button>
                    </td>
                    <td>
                      <StatusBadge status={device.status} />
                    </td>
                    <td>
                      <div className={styles.lastSeenCell}>
                        <ClockIcon className={styles.clockIcon} />
                        <span className={styles.monoLastSeen}>{device.lastSeen}</span>
                      </div>
                    </td>
                    <td className={styles.actionsCell}>
                      <div className={styles.actions}>
                        <button
                          className={`${styles.actionBtn} ${styles.actionBrowse}`}
                          title="Browse remote files"
                          aria-label={`Browse files for ${device.name}`}
                          onClick={() => onBrowse?.(device)}
                          type="button"
                        >
                          <FolderIcon />
                        </button>
                        <button
                          className={`${styles.actionBtn} ${styles.actionBackup}`}
                          title="Run manual backup"
                          aria-label={`Backup ${device.name}`}
                          onClick={() => onBackup?.(device)}
                          type="button"
                        >
                          <BackupIcon />
                        </button>
                        <button
                          className={`${styles.actionBtn} ${styles.actionRestore}`}
                          title="Restore snapshot"
                          aria-label={`Restore ${device.name}`}
                          onClick={() => onRestore?.(device)}
                          type="button"
                        >
                          <RestoreIcon />
                        </button>
                        <button
                          className={`${styles.actionBtn} ${styles.actionEdit}`}
                          title="Edit device configuration"
                          aria-label={`Edit ${device.name}`}
                          onClick={() => onEdit?.(device)}
                          type="button"
                        >
                          <EditIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className={styles.emptyTableCell} colSpan={6}>
                  <div className={styles.emptyState}>
                    <p className={styles.emptyTitle}>No devices found</p>
                    <p className={styles.emptyDesc}>
                      No devices match the active filter or search criteria. Try clearing the filter or search.
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PaginationControls
        page={safePage}
        pageSize={PAGE_SIZE}
        total={devices.length}
        onPrevious={() => setPage((current) => Math.max(0, Math.min(current, totalPages - 1) - 1))}
        onNext={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
      />
    </>
  );
}
