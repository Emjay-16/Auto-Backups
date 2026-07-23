import { JobsWorkspace } from "@/components/JobsWorkspace";
import { getJobsForUi } from "@/lib/api";
import { matchesQuery } from "@/lib/search";
import styles from "@/styles/pages/jobs/jobs.module.css";

type JobsPageProps = {
  searchParams?: Promise<{ q?: string }>;
};

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const query = (await searchParams)?.q ?? "";
  const jobs = await getJobsForUi();
  const filteredJobs = jobs.filter((job) =>
    matchesQuery(query, [job.device, job.type, job.target, job.status, job.time, job.progress]),
  );

  return (
    <div className={styles.page}>
      <JobsWorkspace jobs={filteredJobs} />
    </div>
  );
}
