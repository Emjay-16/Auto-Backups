import type { Device } from "@/lib/types";
import { StatusBadge, StatusDot } from "./StatusBadge";
import { BackupIcon, RestoreIcon } from "./ActionIcons";
import styles from "@/styles/components/DeviceCard.module.css";

type DeviceCardProps = {
  device: Device;
};

export function DeviceCard({ device }: DeviceCardProps) {
  return (
    <article className={styles.card}>
      <div className={styles.top}>
        <div className={styles.avatar}>{device.group}</div>
        <div>
          <strong>{device.name}</strong>
          <span>{device.ip}</span>
        </div>
        <StatusDot status={device.status} />
      </div>
      <div className={styles.meta}>
        <p>
          <span>Group</span>
          <b>{device.group}</b>
        </p>
        <p>
          <span>Last seen</span>
          <b>{device.lastSeen}</b>
        </p>
      </div>
      <div className={styles.footer}>
        <StatusBadge status={device.status} />
        <div className={styles.actions}>
          <button title="Browse files">▤</button>
          <button title="Backup"><BackupIcon /></button>
          <button title="Restore"><RestoreIcon /></button>
        </div>
      </div>
    </article>
  );
}
