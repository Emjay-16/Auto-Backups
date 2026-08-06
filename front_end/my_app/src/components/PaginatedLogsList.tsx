"use client";

import { useState } from "react";
import type { Activity } from "@/lib/types";
import styles from "@/styles/pages/logs/logs.module.css";
import { PaginationControls } from "./PaginationControls";

const PAGE_SIZE = 10;

export function PaginatedLogsList({ activities }: { activities: Activity[] }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(activities.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleActivities = activities.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <>
      <div className={styles.logs}>
        {visibleActivities.length ? visibleActivities.map((item) => (
          <article className={styles.log} key={item.id}>
            <span className={`${styles.icon} ${styles[item.kind]}`}>
              {item.kind === "ok" ? "✓" : item.kind === "fail" ? "×" : item.kind === "wait" ? "◷" : "↑"}
            </span>
            <div className={styles.logMain}>
              <div>
                <strong>{item.text.replaceAll("_", " ")}</strong>
                <p>{item.meta}</p>
              </div>
              <span className={`${styles.statusPill} ${styles[item.kind]}`}>{item.status}</span>
            </div>
            <div className={styles.logMeta}>
              <span>{item.device}</span>
              <span>{item.backup}</span>
              <time>{item.time}</time>
            </div>
          </article>
        )) : (
          <p className={styles.emptyLogs}>No activity logs found</p>
        )}
      </div>
      <PaginationControls
        page={safePage}
        pageSize={PAGE_SIZE}
        total={activities.length}
        onPrevious={() => setPage((current) => Math.max(0, Math.min(current, pageCount - 1) - 1))}
        onNext={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
      />
    </>
  );
}
