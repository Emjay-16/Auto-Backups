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
  const visibleDevices = useMemo(
    () => devices.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [devices, page],
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
            {visibleDevices.length ? visibleDevices.map((device) => (
              <tr key={device.name}>
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
                    <button title="Browse files" aria-label={`Browse files for ${device.name}`} onClick={() => onBrowse?.(device)}><DetailsIcon /></button>
                    <button title="Backup" aria-label={`Backup ${device.name}`} onClick={() => onBackup?.(device)}><BackupIcon /></button>
                    <button title="Restore" aria-label={`Restore ${device.name}`} onClick={() => onRestore?.(device)}><RestoreIcon /></button>
                    <button title="Edit device" aria-label={`Edit ${device.name}`} onClick={() => onEdit?.(device)}><EditIcon /></button>
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
        page={page}
        pageSize={PAGE_SIZE}
        total={devices.length}
        onPrevious={() => setPage((current) => Math.max(0, current - 1))}
        onNext={() => setPage((current) => Math.min(Math.ceil(devices.length / PAGE_SIZE) - 1, current + 1))}
      />
    </>
  );
}
