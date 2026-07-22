import { Panel } from "@/components/Panel";
import { PaginatedLogsList } from "@/components/PaginatedLogsList";
import { getActivitiesForUi } from "@/lib/api";
import { matchesQuery } from "@/lib/search";
import styles from "@/styles/pages/logs/logs.module.css";

type LogsPageProps = {
  searchParams?: Promise<{ q?: string }>;
};

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const query = (await searchParams)?.q ?? "";
  const activities = await getActivitiesForUi();
  const filteredActivities = activities.filter((activity) =>
    matchesQuery(query, [activity.kind, activity.text, activity.meta, activity.time]),
  );

  return (
    <div className={styles.page}>
      <Panel title="Activity Timeline">
        <PaginatedLogsList activities={filteredActivities} />
      </Panel>
    </div>
  );
}
