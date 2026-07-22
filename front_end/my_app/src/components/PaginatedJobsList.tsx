"use client";

import { useMemo, useState } from "react";
import type { Job } from "@/lib/types";
import styles from "@/styles/pages/jobs/jobs.module.css";
import { StatusBadge } from "./StatusBadge";
import { PaginationControls } from "./PaginationControls";

const PAGE_SIZE = 10;

export function PaginatedJobsList({ jobs }: { jobs: Job[] }) {
  const [page, setPage] = useState(0);
  const visibleJobs = useMemo(
    () => jobs.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [jobs, page],
  );

  return (
    <>
      <div className={styles.jobs}>
        {visibleJobs.map((job) => (
          <article className={styles.job} key={`${job.device}-${job.time}-${job.type}`}>
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
        ))}
      </div>
      <PaginationControls
        page={page}
        pageSize={PAGE_SIZE}
        total={jobs.length}
        onPrevious={() => setPage((current) => Math.max(0, current - 1))}
        onNext={() => setPage((current) => Math.min(Math.ceil(jobs.length / PAGE_SIZE) - 1, current + 1))}
      />
    </>
  );
}
