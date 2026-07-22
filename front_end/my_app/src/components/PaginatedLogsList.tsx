"use client";

import { useMemo, useState } from "react";
import type { Activity } from "@/lib/types";
import styles from "@/styles/pages/logs/logs.module.css";
import { PaginationControls } from "./PaginationControls";

const PAGE_SIZE = 10;

export function PaginatedLogsList({ activities }: { activities: Activity[] }) {
  const [page, setPage] = useState(0);
  const visibleActivities = useMemo(
    () => activities.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [activities, page],
  );

  return (
    <>
      <div className={styles.logs}>
        {visibleActivities.map((item) => (
          <article className={styles.log} key={`${item.time}-${item.text}`}>
            <time>{item.time}</time>
            <span className={`${styles.icon} ${styles[item.kind]}`}>
              {item.kind === "ok" ? "✓" : item.kind === "fail" ? "×" : item.kind === "wait" ? "◷" : "↑"}
            </span>
            <div>
              <strong>{item.text}</strong>
              <p>{item.meta}</p>
            </div>
          </article>
        ))}
      </div>
      <PaginationControls
        page={page}
        pageSize={PAGE_SIZE}
        total={activities.length}
        onPrevious={() => setPage((current) => Math.max(0, current - 1))}
        onNext={() => setPage((current) => Math.min(Math.ceil(activities.length / PAGE_SIZE) - 1, current + 1))}
      />
    </>
  );
}
