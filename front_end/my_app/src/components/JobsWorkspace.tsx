"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Job, JobStatus } from "@/lib/types";
import styles from "@/styles/pages/jobs/jobs.module.css";
import { Panel } from "./Panel";
import { PaginatedJobsList } from "./PaginatedJobsList";

type JobFilter = "all" | JobStatus;

const filters: Array<{ key: JobFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "pending", label: "Pending" },
  { key: "skipped", label: "Skipped" },
  { key: "failed", label: "Failed" },
  { key: "success", label: "Success" },
];

export function JobsWorkspace({ jobs, action }: { jobs: Job[]; action?: ReactNode }) {
  const [activeFilter, setActiveFilter] = useState<JobFilter>("all");
  const filteredJobs = useMemo(
    () => activeFilter === "all" ? jobs : jobs.filter((job) => job.status === activeFilter),
    [activeFilter, jobs],
  );

  function countJobs(filter: JobFilter): number {
    if (filter === "all") return jobs.length;
    return jobs.filter((job) => job.status === filter).length;
  }

  return (
    <>
      <section className={styles.tabs}>
        {filters.map((filter) => (
          <button
            className={`${activeFilter === filter.key ? styles.active : ""} ${styles[filter.key] ?? ""}`}
            key={filter.key}
            onClick={() => setActiveFilter(filter.key)}
            type="button"
          >
            <span>{filter.label}</span>
            <b>{countJobs(filter.key)}</b>
          </button>
        ))}
      </section>

      <Panel title="Job Queue" action={action}>
        <PaginatedJobsList key={activeFilter} jobs={filteredJobs} />
      </Panel>
    </>
  );
}
