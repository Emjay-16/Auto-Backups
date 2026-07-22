import type { ReactNode } from "react";
import styles from "@/styles/components/MetricCard.module.css";

type MetricCardProps = {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  progress: number;
  tone?: "default" | "warning";
};

export function MetricCard({ icon, label, value, detail, progress, tone = "default" }: MetricCardProps) {
  return (
    <article className={styles.card}>
      <span className={styles.icon}>{icon}</span>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
      <div className={tone === "warning" ? styles.barWarning : styles.bar}>
        <span style={{ width: `${progress}%` }} />
      </div>
    </article>
  );
}
