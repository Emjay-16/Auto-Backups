import { BackupsWorkspace } from "@/components/BackupsWorkspace";
import { getBackupTargets, getBackupsForUi, getDevicesForUi } from "@/lib/api";
import { matchesQuery } from "@/lib/search";

type BackupsPageProps = {
  searchParams?: Promise<{ q?: string }>;
};

export default async function BackupsPage({ searchParams }: BackupsPageProps) {
  const query = (await searchParams)?.q ?? "";
  const [backups, devices, targets] = await Promise.all([
    getBackupsForUi(),
    getDevicesForUi(),
    getBackupTargets().catch(() => []),
  ]);
  const filteredBackups = backups.filter((backup) =>
    matchesQuery(query, [backup.name, backup.device, backup.type, backup.files, backup.size, backup.status, backup.createdAt]),
  );

  return <BackupsWorkspace backups={filteredBackups} devices={devices} targets={targets} />;
}
