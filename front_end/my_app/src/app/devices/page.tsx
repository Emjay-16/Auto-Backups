import { DevicesInventoryPanel } from "@/components/DevicesInventoryPanel";
import { getDeviceGroupsForUi, getDevicesForUi } from "@/lib/api";
import { matchesQuery } from "@/lib/search";
import styles from "@/styles/pages/devices/devices.module.css";

type DevicesPageProps = {
  searchParams?: Promise<{ q?: string }>;
};

export default async function DevicesPage({ searchParams }: DevicesPageProps) {
  const query = (await searchParams)?.q ?? "";
  const [devices, groups] = await Promise.all([getDevicesForUi(), getDeviceGroupsForUi()]);
  const filteredDevices = devices.filter((device) =>
    matchesQuery(query, [device.name, device.code, device.group, device.ip, device.status, device.lastSeen]),
  );
  const onlineCount = filteredDevices.filter((device) => device.status === "online").length;
  const offlineCount = filteredDevices.filter((device) => device.status === "offline").length;
  const pendingCount = filteredDevices.filter((device) => device.status === "pending").length;

  return (
    <div className={styles.page}>
      <section className={styles.overview}>
        <article>
          <span>All devices</span>
          <strong>{filteredDevices.length}</strong>
        </article>
        <article>
          <span>Online</span>
          <strong className={styles.online}>{onlineCount}</strong>
        </article>
        <article>
          <span>Pending</span>
          <strong className={styles.pending}>{pendingCount}</strong>
        </article>
        <article>
          <span>Offline</span>
          <strong className={styles.offline}>{offlineCount}</strong>
        </article>
      </section>

      <DevicesInventoryPanel devices={filteredDevices} groups={groups} />
    </div>
  );
}
