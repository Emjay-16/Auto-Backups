import { BackupIcon, DeviceIcon, JobIcon, RestoreIcon } from "@/components/ActionIcons";
import { DeviceStatusPanel } from "@/components/DeviceStatusPanel";
import { MetricCard } from "@/components/MetricCard";
import { Panel } from "@/components/Panel";
import { getActivitiesForUi, getBackupsForUi, getDevicesForUi, getJobsForUi } from "@/lib/api";
import { matchesQuery } from "@/lib/search";
import styles from "@/styles/pages/dashboard/page.module.css";

type DashboardPageProps = {
  searchParams?: Promise<{ q?: string }>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const query = (await searchParams)?.q ?? "";
  const [devices, backups, jobs, activities] = await Promise.all([
    getDevicesForUi(),
    getBackupsForUi(),
    getJobsForUi(),
    getActivitiesForUi(),
  ]);
  const activeDevices = devices
    .filter((device) => device.status === "online")
    .filter((device) => matchesQuery(query, [device.name, device.code, device.group, device.ip, device.lastSeen]));
  const failedBackups = backups.filter((backup) => backup.status === "failed").length;
  const pendingJobs = jobs.filter((job) => job.status === "pending").length;
  const successfulBackups = backups.filter((backup) => backup.status === "success").length;
  const restoreActivities = activities.filter((activity) => activity.action.toLowerCase() === "restore");
  const successfulRestores = restoreActivities.filter((activity) => activity.status === "Success").length;
  const failedRestores = restoreActivities.filter((activity) => activity.status === "Failed").length;

  return (
    <div className={styles.page}>
      <section className={styles.metricGrid}>
        <MetricCard icon={<DeviceIcon />} label="Online" value={`${activeDevices.length}`} detail={`${devices.length} Total Devices`} progress={devices.length ? (activeDevices.length / devices.length) * 100 : 0} />
        <MetricCard icon={<BackupIcon />} label="Backups" value={`${backups.length}`} detail={`${successfulBackups} success · ${failedBackups} failed`} progress={backups.length ? (successfulBackups / backups.length) * 100 : 0} />
        <MetricCard
          icon={<RestoreIcon />}
          label="Restores"
          value={`${restoreActivities.length}`}
          detail={`${successfulRestores} success · ${failedRestores} failed`}
          progress={restoreActivities.length ? (successfulRestores / restoreActivities.length) * 100 : 0}
        />
        <MetricCard icon={<JobIcon />} label="Pending Jobs" value={`${pendingJobs}`} detail="retry every hour" progress={pendingJobs ? 38 : 0} tone="warning" />
      </section>

      <Panel title="Online Devices">
        <DeviceStatusPanel devices={activeDevices} />
      </Panel>
    </div>
  );
}
