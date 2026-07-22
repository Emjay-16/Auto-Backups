import type { DeviceStatus, JobStatus } from "@/lib/types";
import styles from "@/styles/components/StatusBadge.module.css";

type StatusBadgeProps = {
  status: DeviceStatus | JobStatus | string;
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`${styles.badge} ${styles[status] ?? ""}`}>{status}</span>;
}

export function StatusDot({ status }: StatusBadgeProps) {
  return <span className={`${styles.dot} ${styles[status] ?? ""}`} />;
}
