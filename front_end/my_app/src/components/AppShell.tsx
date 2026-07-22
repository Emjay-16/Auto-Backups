"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { clearClientAccessTokenCache, getNotificationsForUi, setClientAccessTokenCache, type NotificationItem } from "@/lib/api";
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

const READ_NOTIFICATIONS_KEY = "auto_backup_read_notifications";
const CLEARED_NOTIFICATIONS_KEY = "auto_backup_cleared_notifications";

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const current = pageTitles[pathname] ?? pageTitles["/"];
  const [deviceCount, setDeviceCount] = useState({ online: 0, total: 0 });
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [now, setNow] = useState<Date | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>(() => readStoredIds(READ_NOTIFICATIONS_KEY));
  const [clearedNotificationIds, setClearedNotificationIds] = useState<string[]>(() => readStoredIds(CLEARED_NOTIFICATIONS_KEY));
  const [showNotifications, setShowNotifications] = useState(false);
  const isLoginPage = pathname === "/login";

  useEffect(() => {
    const startId = window.setTimeout(() => {
      if (status === "unauthenticated" && !isLoginPage) {
        router.replace("/login");
      }
      if (status === "authenticated" && isLoginPage) {
        router.replace("/");
      }
    }, 0);

    return () => window.clearTimeout(startId);
  }, [isLoginPage, router, status]);

  useEffect(() => {
    setClientAccessTokenCache(session?.accessToken ?? null);
  }, [session?.accessToken]);

  useEffect(() => {
    if (!session) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    const startId = window.setTimeout(() => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 1500);

      fetch(`${apiUrl}/devices/`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error("Failed to load devices");
          return response.json() as Promise<{ device_status: number }[]>;
        })
        .then((devices) => {
          setDeviceCount({
            online: devices.filter((device) => device.device_status === 1).length,
            total: devices.length,
          });
        })
        .catch(() => {
          setDeviceCount({ online: 0, total: 0 });
        })
        .finally(() => window.clearTimeout(timeoutId));
    }, 1000);

    return () => {
      window.clearTimeout(startId);
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    const accessToken = session.accessToken;

    function loadActiveJobs() {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 1500);

      Promise.all([
        fetch(`${apiUrl}/jobs/?job_status=0&limit=100`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          signal: controller.signal,
        }).then((response) => (response.ok ? response.json() as Promise<unknown[]> : [])),
        fetch(`${apiUrl}/jobs/?job_status=4&limit=100`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          signal: controller.signal,
        }).then((response) => (response.ok ? response.json() as Promise<unknown[]> : [])),
      ])
        .then(([runningJobs, pendingJobs]) => {
          setActiveJobCount(runningJobs.length + pendingJobs.length);
        })
        .catch(() => {
          setActiveJobCount(0);
        })
        .finally(() => window.clearTimeout(timeoutId));
    }

    const startId = window.setTimeout(loadActiveJobs, 1500);
    const intervalId = window.setInterval(loadActiveJobs, 30000);

    return () => {
      window.clearTimeout(startId);
      window.clearInterval(intervalId);
    };
  }, [session]);

  useEffect(() => {
    const startId = window.setTimeout(() => setNow(new Date()), 0);
    const intervalId = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.clearTimeout(startId);
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
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

    const startId = window.setTimeout(loadNotifications, 2500);
    const intervalId = window.setInterval(loadNotifications, 60000);

    return () => {
      mounted = false;
      window.clearTimeout(startId);
      window.clearInterval(intervalId);
    };
  }, [session]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const query = String(formData.get("q") ?? "").trim();
    router.push(query ? `${pathname}?q=${encodeURIComponent(query)}` : pathname);
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

  function logout() {
    clearClientAccessTokenCache();
    signOut({ callbackUrl: "/login" });
  }

  const dateText = now
    ? now.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" })
    : "--";
  const timeText = now
    ? now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "--";
  const visibleNotifications = notifications.filter((item) => !clearedNotificationIds.includes(item.id));
  const unreadCount = visibleNotifications.filter((item) => !readNotificationIds.includes(item.id)).length;

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (status === "loading" || !session) {
    return (
      <main className={styles.authLoading}>
        <span>AB</span>
        <strong>กำลังตรวจสอบสิทธิ์...</strong>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>AB</div>
          <div>
            <strong>Auto Backup</strong>
            <span>Robot fleet manager</span>
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
          <div className={styles.avatar}>A</div>
          <div>
            <strong>{session.user.name}</strong>
            <span>online</span>
          </div>
          <button onClick={logout} type="button">Logout</button>
        </div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.titleBlock}>
            <p className={styles.eyebrow}>{current.crumb}</p>
            <h1>{current.title}</h1>
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
                placeholder="ค้นหาอุปกรณ์, backup, job..."
              />
            </form>
            <div className={styles.notificationWrap}>
              <button
                className={styles.iconButton}
                type="button"
                aria-label="Notifications"
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
                      <article className={`${styles.notificationItem} ${styles[item.tone]} ${readNotificationIds.includes(item.id) ? styles.read : ""}`} key={item.id}>
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
              <strong>{deviceCount.online} / {deviceCount.total}</strong>
              <span>online devices</span>
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
