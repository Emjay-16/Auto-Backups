"use client";

import { useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Backup, Device, Job } from "@/lib/types";
import styles from "@/styles/components/DashboardAnalytics.module.css";

type DashboardAnalyticsProps = {
  backups: Backup[];
  jobs: Job[];
  devices: Device[];
};

const THAI_SHORT_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
];

function parseSizeToBytes(sizeStr: string): number {
  if (!sizeStr) return 0;
  const match = sizeStr.trim().match(/^([\d.]+)\s*([a-zA-Z]+)?$/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = (match[2] || "B").toUpperCase();
  if (unit === "KB") return num * 1024;
  if (unit === "MB") return num * 1024 * 1024;
  if (unit === "GB") return num * 1024 * 1024 * 1024;
  if (unit === "TB") return num * 1024 * 1024 * 1024 * 1024;
  return num;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDayLabel(date: Date, isToday: boolean): string {
  if (isToday) return "วันนี้";
  return `${date.getDate()} ${THAI_SHORT_MONTHS[date.getMonth()]}`;
}

export function DashboardAnalytics({ backups, jobs, devices }: DashboardAnalyticsProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // รีเฟรชอัตโนมัติทุก 1.30 นาที (90 วินาที)
  useEffect(() => {
    const timer = setInterval(() => {
      startTransition(() => {
        router.refresh();
      });
    }, 90 * 1000);

    return () => clearInterval(timer);
  }, [router]);

  // Compute 7-day trend
  const trendData = useMemo(() => {
    const days: Array<{
      dateKey: string;
      label: string;
      isToday: boolean;
      success: number;
      failed: number;
      total: number;
    }> = [];

    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const dateKey = `${y}-${m}-${day}`;

      days.push({
        dateKey,
        label: formatDayLabel(d, i === 0),
        isToday: i === 0,
        success: 0,
        failed: 0,
        total: 0,
      });
    }

    for (const b of backups) {
      const rawDate = b.createdAtRaw || b.createdAt || "";
      const match = rawDate.match(/^(\d{4}-\d{2}-\d{2})/);
      if (match) {
        const itemDate = match[1];
        const dayEntry = days.find((d) => d.dateKey === itemDate);
        if (dayEntry) {
          dayEntry.total += 1;
          if (b.status === "failed") {
            dayEntry.failed += 1;
          } else {
            dayEntry.success += 1;
          }
        }
      }
    }

    return days;
  }, [backups]);

  // Peak backups in a single day for chart height scaling
  const maxDayCount = useMemo(() => {
    const max = Math.max(...trendData.map((d) => d.total), 1);
    return Math.max(max, 5);
  }, [trendData]);

  // Total storage calculation
  const totalStorageBytes = useMemo(() => {
    return backups.reduce((sum, b) => sum + parseSizeToBytes(b.size), 0);
  }, [backups]);

  // 7-day success rate
  const weekStats = useMemo(() => {
    const total = trendData.reduce((acc, d) => acc + d.total, 0);
    const success = trendData.reduce((acc, d) => acc + d.success, 0);
    const rate = total > 0 ? ((success / total) * 100).toFixed(1) : "100";
    return { total, success, rate };
  }, [trendData]);

  return (
    <div className={styles.container}>
      {/* Analytics Grid: Trends + Storage Summary */}
      <section className={styles.analyticsGrid}>
        {/* 7-Day Backup Trend Chart */}
        <article className={styles.trendCard}>
          <div className={styles.cardHeader}>
            <div>
              <h3>สถิติการสำรองข้อมูล 7 วันล่าสุด</h3>
              <p>อัตราความสำเร็จสัปดาห์นี้: <strong>{weekStats.rate}%</strong> ({weekStats.success}/{weekStats.total} รายการ)</p>
            </div>
            <div className={styles.legend}>
              <span className={styles.legendSuccess}>
                <i /> สำเร็จ
              </span>
              <span className={styles.legendFailed}>
                <i /> ล้มเหลว
              </span>
            </div>
          </div>

          <div className={styles.chartContainer}>
            <div className={styles.barsArea}>
              {trendData.map((day) => {
                const totalHeightPct = Math.round((day.total / maxDayCount) * 100);
                const successHeightPct = day.total > 0 ? (day.success / day.total) * 100 : 0;
                const failedHeightPct = day.total > 0 ? (day.failed / day.total) * 100 : 0;

                return (
                  <div key={day.dateKey} className={styles.barCol}>
                    <div className={styles.barTrack} title={`${day.dateKey}: สำเร็จ ${day.success}, ล้มเหลว ${day.failed}`}>
                      {day.total > 0 ? (
                        <div className={styles.barFill} style={{ height: `${Math.max(totalHeightPct, 12)}%` }}>
                          {day.failed > 0 ? (
                            <div className={styles.barFailedPart} style={{ height: `${failedHeightPct}%` }} />
                          ) : null}
                          {day.success > 0 ? (
                            <div className={styles.barSuccessPart} style={{ height: `${successHeightPct}%` }} />
                          ) : null}
                        </div>
                      ) : (
                        <div className={styles.barEmpty} />
                      )}
                    </div>
                    <span className={styles.barCount}>{day.total}</span>
                    <span className={`${styles.barLabel} ${day.isToday ? styles.todayLabel : ""}`}>
                      {day.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </article>

        {/* Storage & Quick Actions Card */}
        <article className={styles.storageCard}>
          <div className={styles.cardHeader}>
            <div>
              <h3>พื้นที่จัดเก็บข้อมูลสำรอง (Storage)</h3>
              <p>คำนวณจากไฟล์สำรองทั้งหมดในระบบ</p>
            </div>
            <span className={styles.storageBadge}>{formatBytes(totalStorageBytes)}</span>
          </div>

          <div className={styles.storageStats}>
            <div className={styles.statBox}>
              <span>ไฟล์สำรองทั้งหมด</span>
              <strong>{backups.length}</strong>
              <small>ไฟล์ Archives</small>
            </div>
            <div className={styles.statBox}>
              <span>อุปกรณ์ในระบบ</span>
              <strong>{devices.length}</strong>
              <small>{devices.filter((d) => d.status === "online").length} เครื่อง Online</small>
            </div>
            <div className={styles.statBox}>
              <span>คิวงานคงค้าง</span>
              <strong>{jobs.filter((j) => j.status === "pending" || j.status === "running").length}</strong>
              <small>Pending / Running</small>
            </div>
          </div>

          <div className={styles.quickActionGroup}>
            <Link href="/backups" className={styles.actionBtn}>
              จัดการไฟล์สำรอง
            </Link>
            <Link href="/restore" className={styles.actionBtn}>
              กู้คืนข้อมูล
            </Link>
            <Link href="/jobs" className={styles.actionBtn}>
              ติดตามคิวงาน
            </Link>
          </div>
        </article>
      </section>
    </div>
  );
}
