"use client";

import { useMemo, useState } from "react";
import type { Device } from "@/lib/types";
import styles from "@/styles/pages/devices/devices.module.css";
import { StatusBadge, StatusDot } from "./StatusBadge";
import { PaginationControls } from "./PaginationControls";
import { BackupIcon, DetailsIcon, EditIcon, RestoreIcon } from "./ActionIcons";
import { RobotGroupBadge } from "./RobotGroupBadge";

const PAGE_SIZE = 10;

export function PaginatedDevicesTable({
  devices,
  onBackup,
  onBrowse,
  onEdit,
  onRestore,
}: {
  devices: Device[];
  onBackup?: (device: Device) => void;
  onBrowse?: (device: Device) => void;
  onEdit?: (device: Device) => void;
  onRestore?: (device: Device) => void;
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(devices.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visibleDevices = useMemo(
    () => devices.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [devices, safePage],
  );

  return (
    <>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Device</th>
              <th>Group</th>
              <th>IP Address</th>
              <th>Status</th>
              <th>Last Seen</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleDevices.length ? visibleDevices.map((device, index) => (
              <tr key={device.id || device.code || device.ip || `${device.name}-${index}`}>
                <td className={styles.deviceCell}>
                  <StatusDot status={device.status} />
                  <div>
                    <strong>{device.name}</strong>
                    <span>{device.code || "Robot unit"}</span>
                  </div>
                </td>
                <td>
                  <RobotGroupBadge group={device.group} />
                </td>
                <td className={styles.mono}>{device.ip}</td>
                <td>
                  <StatusBadge status={device.status} />
                </td>
                <td className={styles.mono}>{device.lastSeen}</td>
                <td className={styles.actionsCell}>
                  <div className={styles.actions}>
                    <button title="Browse files" aria-label={`Browse files for ${device.name}`} onClick={() => onBrowse?.(device)} type="button"><DetailsIcon /></button>
                    <button title="Backup" aria-label={`Backup ${device.name}`} onClick={() => onBackup?.(device)} type="button"><BackupIcon /></button>
                    <button title="Restore" aria-label={`Restore ${device.name}`} onClick={() => onRestore?.(device)} type="button"><RestoreIcon /></button>
                    <button title="Edit device" aria-label={`Edit ${device.name}`} onClick={() => onEdit?.(device)} type="button"><EditIcon /></button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td className={styles.emptyTableCell} colSpan={6}>
                  <strong>No devices found</strong>
                  <span>Try a different filter or add a new device.</span>
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
