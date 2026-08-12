import { DateFilter } from "@/components/DateFilter";
import { Panel } from "@/components/Panel";
import { PaginatedLogsList } from "@/components/PaginatedLogsList";
import { getActivitiesForUi } from "@/lib/api";
import { todayDateInputValue } from "@/lib/date";
import { matchesQuery } from "@/lib/search";
import styles from "@/styles/pages/logs/logs.module.css";

type LogsPageProps = {
  searchParams?: Promise<{ q?: string; date?: string }>;
};

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const params = await searchParams;
  const query = params?.q ?? "";
  const selectedDate = params?.date || todayDateInputValue();
  const activities = await getActivitiesForUi(selectedDate);
  const filteredActivities = activities.filter((activity) =>
    matchesQuery(query, [activity.kind, activity.text, activity.meta, activity.time]),
  );
  const successCount = filteredActivities.filter((activity) => activity.kind === "ok").length;
  const failedCount = filteredActivities.filter((activity) => activity.kind === "fail").length;
  const runningCount = filteredActivities.filter((activity) => activity.kind === "run" || activity.kind === "wait").length;

  return (
    <div className={styles.page}>
      <section className={styles.summaryGrid}>
        <article>
          <span>Total logs</span>
          <strong>{filteredActivities.length}</strong>
        </article>
        <article className={styles.success}>
          <span>Success</span>
          <strong>{successCount}</strong>
        </article>
        <article className={styles.failed}>
          <span>Failed</span>
          <strong>{failedCount}</strong>
        </article>
        <article className={styles.running}>
          <span>Running / Pending</span>
          <strong>{runningCount}</strong>
        </article>
      </section>
      <Panel title="Activity Timeline" action={<DateFilter value={selectedDate} label="เลือกวันที่" />}>
        <PaginatedLogsList activities={filteredActivities} />
      </Panel>
    </div>
  );
}
