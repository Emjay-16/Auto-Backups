import type { ReactNode } from "react";
import styles from "@/styles/components/Panel.module.css";

type PanelProps = {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Panel({ title, action, children, className = "" }: PanelProps) {
  return (
    <section className={`${styles.panel} ${className}`}>
      <div className={styles.header}>
        <h2>{title}</h2>
        {action ? <div className={styles.action}>{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
