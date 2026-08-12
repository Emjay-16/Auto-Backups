import { DateFilter } from "@/components/DateFilter";
import { JobsWorkspace } from "@/components/JobsWorkspace";
import { getJobsForUi } from "@/lib/api";
import { todayDateInputValue } from "@/lib/date";
import { matchesQuery } from "@/lib/search";
import styles from "@/styles/pages/jobs/jobs.module.css";

type JobsPageProps = {
  searchParams?: Promise<{ q?: string; date?: string }>;
};

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const params = await searchParams;
  const query = params?.q ?? "";
  const selectedDate = params?.date || todayDateInputValue();
  const jobs = await getJobsForUi(selectedDate);
  const filteredJobs = jobs.filter((job) =>
    matchesQuery(query, [job.device, job.type, job.target, job.status, job.time, job.progress]),
  );

  return (
    <div className={styles.page}>
      <JobsWorkspace jobs={filteredJobs} action={<DateFilter value={selectedDate} label="เลือกวันที่" />} />
    </div>
  );
}
