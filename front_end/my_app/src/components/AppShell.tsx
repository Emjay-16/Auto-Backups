"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { fetchApi, getNotificationsForUi, type NotificationItem } from "@/lib/api";
import styles from "@/styles/components/AppShell.module.css";
import { BackupIcon, DashboardIcon, DeviceIcon, JobIcon, RestoreIcon } from "./ActionIcons";

type NavItem = {
  href: string;
  icon: ReactNode;
  label: string;
  badge?: string;
};

const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [
      { href: "/", icon: <DashboardIcon />, label: "Dashboard" },
      { href: "/devices", icon: <DeviceIcon />, label: "Devices" },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/backups", icon: <BackupIcon />, label: "Backups" },
      { href: "/restore", icon: <RestoreIcon />, label: "Restore" },
      { href: "/jobs", icon: <JobIcon />, label: "Jobs" },
    ],
  },
  {
    title: "System",
    items: [{ href: "/logs", icon: "≡", label: "Activity Logs" }],
  },
];

const pageTitles: Record<string, { title: string; crumb: string }> = {
  "/": { title: "Dashboard", crumb: "Fleet Backup Console" },
  "/devices": { title: "Devices", crumb: "Monitor robot connectivity and actions" },
  "/backups": { title: "Backups", crumb: "Browse backup history and storage" },
  "/restore": { title: "Restore", crumb: "Select backup files and restore targets" },
  "/jobs": { title: "Jobs", crumb: "Track running, skipped, and pending work" },
  "/logs": { title: "Activity Logs", crumb: "Audit backup, restore, and device events" },
};

// Sorted longest-first so nested routes resolve to their section title.
const orderedPageTitleRoutes = Object.keys(pageTitles).sort((a, b) => b.length - a.length);

function resolvePageTitle(pathname: string) {
  if (pathname in pageTitles) return pageTitles[pathname];
  const match = orderedPageTitleRoutes.find(
    (route) => route !== "/" && (pathname === route || pathname.startsWith(`${route}/`))
  );
  return match ? pageTitles[match] : pageTitles["/"];
}

const READ_NOTIFICATIONS_KEY = "auto_backup_read_notifications";
const CLEARED_NOTIFICATIONS_KEY = "auto_backup_cleared_notifications";

const TIMING = {
  deviceFetchTimeoutMs: 5000,
  deviceRefreshDelayMs: 1000,
  deviceRefreshTimeoutMs: 20000,
  jobsFetchTimeoutMs: 5000,
  jobsInitialDelayMs: 500,
  jobsPollIntervalMs: 10000,
  clockTickMs: 1000,
  notificationsInitialDelayMs: 2500,
  notificationsPollIntervalMs: 60000,
} as const;

type NotificationTone = "fail" | "wait" | "info";
const KNOWN_NOTIFICATION_TONES: readonly NotificationTone[] = ["fail", "wait", "info"];
type ShellJob = {
  job_status: number;
  job_type?: string;
};

function toneClassName(tone: string): string {
  return KNOWN_NOTIFICATION_TONES.includes(tone as NotificationTone)
    ? styles[tone as NotificationTone]
    : styles.info;
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, status: sessionStatus } = useSession();
  const isLoginPage = pathname === "/login";
  const current = resolvePageTitle(pathname);
  const [deviceCount, setDeviceCount] = useState({ online: 0, total: 0 });
  const [devicesUnavailable, setDevicesUnavailable] = useState(false);
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [activeAutoBackupCount, setActiveAutoBackupCount] = useState(0);
  const [now, setNow] = useState<Date | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
  const [clearedNotificationIds, setClearedNotificationIds] = useState<string[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const notificationWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLoginPage || sessionStatus !== "authenticated") return;

    const storageId = window.setTimeout(() => {
      setReadNotificationIds(readStoredIds(READ_NOTIFICATIONS_KEY));
      setClearedNotificationIds(readStoredIds(CLEARED_NOTIFICATIONS_KEY));
    }, 0);
    return () => window.clearTimeout(storageId);
  }, [isLoginPage, sessionStatus]);
  useEffect(() => {
    if (isLoginPage || sessionStatus !== "authenticated") return;

    function fetchDevices(path: string, timeoutMs: number) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
      return fetchApi(path, { cache: "no-store", signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error("Failed to load devices");
          return response.json() as Promise<{ device_status: number }[]>;
        })
        .finally(() => window.clearTimeout(timeoutId));
    }

    function loadDeviceCount(path: string, timeoutMs: number) {
      return fetchDevices(path, timeoutMs)
        .catch(() => fetchDevices("/devices/", TIMING.deviceFetchTimeoutMs))
        .then((devices) => {
          setDeviceCount({
            online: devices.filter((device) => device.device_status === 1).length,
            total: devices.length,
          });
          setDevicesUnavailable(false);
        })
        .catch(() => setDevicesUnavailable(true));
    }

    void loadDeviceCount("/devices/", TIMING.deviceFetchTimeoutMs);
    const startId = window.setTimeout(() => {
      void loadDeviceCount("/devices/?refresh_status=true", TIMING.deviceRefreshTimeoutMs);
    }, TIMING.deviceRefreshDelayMs);

    return () => {
      window.clearTimeout(startId);
    };
  }, [isLoginPage, sessionStatus]);

  useEffect(() => {
    if (isLoginPage || sessionStatus !== "authenticated") return;
    function loadActiveJobs() {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), TIMING.jobsFetchTimeoutMs);

      fetchApi("/jobs/?limit=100", {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() as Promise<ShellJob[]> : []))
        .then((jobs) => {
          const activeJobs = jobs.filter((job) => isActiveJob(job));
          setActiveJobCount(activeJobs.length);
          setActiveAutoBackupCount(activeJobs.filter((job) => job.job_type === "auto_backup").length);
        })
        .catch(() => {
          setActiveJobCount(0);
          setActiveAutoBackupCount(0);
        })
        .finally(() => window.clearTimeout(timeoutId));
    }

    const startId = window.setTimeout(loadActiveJobs, TIMING.jobsInitialDelayMs);
    const intervalId = window.setInterval(loadActiveJobs, TIMING.jobsPollIntervalMs);

    return () => {
      window.clearTimeout(startId);
      window.clearInterval(intervalId);
    };
  }, [isLoginPage, sessionStatus]);

  useEffect(() => {
    const startId = window.setTimeout(() => setNow(new Date()), 0);
    const intervalId = window.setInterval(() => setNow(new Date()), TIMING.clockTickMs);
    return () => {
      window.clearTimeout(startId);
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (isLoginPage || sessionStatus !== "authenticated") return;

    let mounted = true;

    function loadNotifications() {
      getNotificationsForUi()
        .then((items) => {
          if (mounted) setNotifications(items);
        })
        .catch(() => {
          if (mounted) setNotifications([]);
        });
    }

    const startId = window.setTimeout(loadNotifications, TIMING.notificationsInitialDelayMs);
    const intervalId = window.setInterval(loadNotifications, TIMING.notificationsPollIntervalMs);

    return () => {
      mounted = false;
      window.clearTimeout(startId);
      window.clearInterval(intervalId);
    };
  }, [isLoginPage, sessionStatus]);

  useEffect(() => {
    if (!isLoginPage && sessionStatus === "unauthenticated") {
      router.replace("/login");
    }
  }, [isLoginPage, router, sessionStatus]);

  useEffect(() => {
    if (isLoginPage || sessionStatus !== "authenticated" || !session?.expires) return;

    const expiresAt = Date.parse(session.expires);
    if (!Number.isFinite(expiresAt)) return;

    const delayMs = Math.max(expiresAt - Date.now(), 0);
    const timeoutId = window.setTimeout(() => {
      void signOut({ redirect: false }).finally(() => {
        router.replace("/login");
        router.refresh();
      });
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [isLoginPage, router, session?.expires, sessionStatus]);

  useEffect(() => {
    if (!showNotifications) return;

    function handlePointerDown(event: MouseEvent) {
      if (!notificationWrapRef.current?.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setShowNotifications(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showNotifications]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    const params = new URLSearchParams(window.location.search);
    if (query) {
      params.set("q", query);
    } else {
      params.delete("q");
    }
    const nextQuery = params.toString();
    router.push(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }

  function clearSearch() {
    setSearchQuery("");
    const params = new URLSearchParams(window.location.search);
    params.delete("q");
    const nextQuery = params.toString();
    router.push(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }

  function openNotifications() {
    setShowNotifications((current) => {
      const next = !current;
      if (next) markVisibleNotificationsAsRead();
      return next;
    });
  }

  function markVisibleNotificationsAsRead() {
    const ids = visibleNotifications.map((item) => item.id);
    setReadNotificationIds((current) => saveStoredIds(READ_NOTIFICATIONS_KEY, [...current, ...ids]));
  }

  function clearNotifications() {
    const ids = visibleNotifications.map((item) => item.id);
    setClearedNotificationIds((current) => saveStoredIds(CLEARED_NOTIFICATIONS_KEY, [...current, ...ids]));
    setReadNotificationIds((current) => saveStoredIds(READ_NOTIFICATIONS_KEY, [...current, ...ids]));
  }

  async function logout() {
    await signOut({ redirect: false });
    router.replace("/login");
    router.refresh();
  }

  const dateText = now
    ? now.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" })
    : "--";
  const timeText = now
    ? now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "--";
  const visibleNotifications = notifications.filter((item) => !clearedNotificationIds.includes(item.id));
  const unreadCount = visibleNotifications.filter((item) => !readNotificationIds.includes(item.id)).length;
  const userName = session?.user?.name || "User";

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (sessionStatus !== "authenticated") {
    return null;
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>AB</div>
          <div>
            <strong>Auto Backup</strong>
            <span>Robot Data Migration</span>
          </div>
        </div>

        <nav className={styles.nav}>
          {navSections.map((section) => (
            <div className={styles.navGroup} key={section.title}>
              <p>{section.title}</p>
              {section.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link className={`${styles.navItem} ${active ? styles.active : ""}`} href={item.href} key={item.href}>
                    <span>{item.icon}</span>
                    {item.label}
                    {item.href === "/jobs" && activeJobCount > 0 ? <b>{activeJobCount}</b> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={styles.operator}>
          <div className={styles.avatar}>{userName.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{userName}</strong>
          </div>
          <button onClick={() => void logout()} type="button">
            Logout
          </button>
        </div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.titleBlock}>
            <div>
              <p className={styles.eyebrow}>{current.crumb}</p>
              <h1>{current.title}</h1>
            </div>
          </div>
          <div className={styles.topActions}>
            <form className={styles.search} onSubmit={submitSearch}>
              <span aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
                  <path d="M480 272C480 317.9 465.1 360.3 440 394.7L566.6 521.4C579.1 533.9 579.1 554.2 566.6 566.7C554.1 579.2 533.8 579.2 521.3 566.7L394.7 440C360.3 465.1 317.9 480 272 480C157.1 480 64 386.9 64 272C64 157.1 157.1 64 272 64C386.9 64 480 157.1 480 272zM272 416C351.5 416 416 351.5 416 272C416 192.5 351.5 128 272 128C192.5 128 128 192.5 128 272C128 351.5 192.5 416 272 416z" />
                </svg>
              </span>
              <input
                name="q"
                aria-label="ค้นหาอุปกรณ์, backup หรือ job"
                placeholder="ค้นหาอุปกรณ์, backup, job..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <button
                aria-label="ล้างคำค้นหา"
                className={styles.clearSearch}
                disabled={!searchQuery}
                onClick={clearSearch}
                type="button"
              >
                ×
              </button>
            </form>
            <div className={styles.notificationWrap} ref={notificationWrapRef}>
              <button
                className={styles.iconButton}
                type="button"
                aria-label="Notifications"
                aria-haspopup="true"
                aria-expanded={showNotifications}
                onClick={openNotifications}
              >
                <BellIcon />
                {unreadCount ? <span>{unreadCount}</span> : null}
              </button>
              {showNotifications ? (
                <div className={styles.notificationPanel}>
                  <div className={styles.notificationHeader}>
                    <div>
                      <strong>Notifications</strong>
                      <span>{visibleNotifications.length} items</span>
                    </div>
                    <button onClick={clearNotifications} disabled={!visibleNotifications.length} type="button">
                      Clear
                    </button>
                  </div>
                  {visibleNotifications.length ? (
                    visibleNotifications.map((item) => (
                      <article className={`${styles.notificationItem} ${toneClassName(item.tone)} ${readNotificationIds.includes(item.id) ? styles.read : ""}`} key={item.id}>
                        <b>{item.title}</b>
                        <p>{item.detail}</p>
                        <time>{item.time}</time>
                      </article>
                    ))
                  ) : (
                    <p className={styles.emptyNotice}>No active alerts</p>
                  )}
                </div>
              ) : null}
            </div>
            <div className={styles.statusBox}>
              <strong className={activeAutoBackupCount ? styles.statusRunning : devicesUnavailable ? styles.statusUnavailable : undefined}>
                {activeAutoBackupCount ? `${activeAutoBackupCount} running` : devicesUnavailable ? "—" : `${deviceCount.online} / ${deviceCount.total}`}
              </strong>
              <span>{activeAutoBackupCount ? "auto backup" : devicesUnavailable ? "status unavailable" : "online devices"}</span>
            </div>
            <div className={styles.dateBox}>
              <strong>{dateText}</strong>
              <span>{timeText}</span>
            </div>
          </div>
        </header>
        {children}
      </section>
    </main>
  );
}

function readStoredIds(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveStoredIds(key: string, ids: string[]): string[] {
  const uniqueIds = Array.from(new Set(ids)).slice(-300);
  window.localStorage.setItem(key, JSON.stringify(uniqueIds));
  return uniqueIds;
}

function isActiveJob(job: ShellJob): boolean {
  return job.job_status === 0 || job.job_status === 4;
}

function BellIcon() {
  return (
    <svg aria-hidden="true" className={styles.bellIcon} fill="none" viewBox="0 0 24 24">
      <path
        d="M15 17H9m9-2.5c-.8-.9-1.2-2.1-1.2-3.4V9a4.8 4.8 0 0 0-9.6 0v2.1c0 1.3-.4 2.5-1.2 3.4L5 16h14l-1-1.5ZM13.5 19a1.7 1.7 0 0 1-3 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
