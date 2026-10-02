import { DevicesInventoryPanel } from "@/components/DevicesInventoryPanel";
import { getDeviceGroupsForUi, getDevicesForUi } from "@/lib/api";
import styles from "@/styles/pages/devices/devices.module.css";

export default async function DevicesPage() {
  const [devices, groups] = await Promise.all([
    getDevicesForUi().catch(() => []),
    getDeviceGroupsForUi().catch(() => []),
  ]);

  return (
    <div className={styles.page}>
      <DevicesInventoryPanel devices={devices} groups={groups} />
    </div>
  );
}

