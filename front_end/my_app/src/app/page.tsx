import { DashboardAnalytics } from "@/components/DashboardAnalytics";
import { DeviceStatusPanel } from "@/components/DeviceStatusPanel";
import { Panel } from "@/components/Panel";
import { getBackupsForUi, getDevicesForUi, getJobsForUi } from "@/lib/api";
import { matchesQuery } from "@/lib/search";
import styles from "@/styles/pages/dashboard/page.module.css";

type DashboardPageProps = {
  searchParams?: Promise<{ q?: string }>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const query = (await searchParams)?.q ?? "";
  const [devicesRes, backupsRes, jobsRes] = await Promise.allSettled([
    getDevicesForUi(),
    getBackupsForUi(),
    getJobsForUi(),
  ]);
  const devices = devicesRes.status === "fulfilled" ? devicesRes.value : [];
  const backups = backupsRes.status === "fulfilled" ? backupsRes.value : [];
  const jobs = jobsRes.status === "fulfilled" ? jobsRes.value : [];

  const activeDevices = devices
    .filter((device) => device.status === "online")
    .filter((device) =>
      matchesQuery(query, [
        device.name ?? "",
        device.code ?? "",
        device.group ?? "",
        device.ip ?? "",
        device.lastSeen ?? "",
      ]),
    );

  return (
    <div className={styles.page}>
      <DashboardAnalytics backups={backups} jobs={jobs} devices={devices} />

      <Panel title="อุปกรณ์ที่ออนไลน์">
        <DeviceStatusPanel devices={activeDevices} backups={backups} />
      </Panel>
    </div>
  );
}
