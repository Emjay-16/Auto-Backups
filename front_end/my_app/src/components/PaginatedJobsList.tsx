"use client";

import { useMemo, useState } from "react";
import type { Job } from "@/lib/types";
import styles from "@/styles/pages/jobs/jobs.module.css";
import { StatusBadge } from "./StatusBadge";
import { PaginationControls } from "./PaginationControls";

const PAGE_SIZE = 10;

export function PaginatedJobsList({ jobs }: { jobs: Job[] }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleJobs = useMemo(
    () => jobs.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [jobs, safePage],
  );

  return (
    <>
      <div className={styles.jobs}>
        {visibleJobs.length ? visibleJobs.map((job) => (
          <article className={styles.job} key={job.id}>
            <div>
              <strong>{job.device}</strong>
              <span>{job.type}</span>
            </div>
            <p>{job.target}</p>
            <div className={styles.progress}>
              <span style={{ width: `${job.progress}%` }} />
            </div>
            <StatusBadge status={job.status} />
            <time>{job.time}</time>
          </article>
        )) : (
          <p className={styles.emptyJobs}>No jobs in this status</p>
        )}
      </div>
      <PaginationControls
        page={safePage}
        pageSize={PAGE_SIZE}
        total={jobs.length}
        onPrevious={() => setPage((current) => Math.max(0, Math.min(current, pageCount - 1) - 1))}
        onNext={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
      />
    </>
  );
}
