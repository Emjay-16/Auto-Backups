"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { todayDateInputValue } from "@/lib/date";
import styles from "@/styles/components/DateFilter.module.css";

type DateFilterProps = {
  value: string;
  label: string;
};

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

const THAI_WEEKDAYS = [
  { key: "sun", label: "อา" },
  { key: "mon", label: "จ" },
  { key: "tue", label: "อ" },
  { key: "wed", label: "พ" },
  { key: "thu", label: "พฤ" },
  { key: "fri", label: "ศ" },
  { key: "sat", label: "ส" },
];

function addDays(ymd: string, days: number): string {
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return ymd;
  const d = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DateFilter({ value, label }: DateFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const today = todayDateInputValue();
  const yesterday = addDays(today, -1);
  const sevenDaysAgo = addDays(today, -7);

  function updateDate(nextDate: string) {
    const normalizedDate = nextDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      return false;
    }
    const params = new URLSearchParams(window.location.search);
    params.set("date", normalizedDate);
    const nextQuery = params.toString();
    router.push(nextQuery ? `${pathname}?${nextQuery}` : pathname);
    return true;
  }

  return (
    <section className={styles.dateFilter} aria-label={label}>
      <div className={styles.dateText}>
        <span>{label}</span>
        <div className={styles.quickPresets}>
          <button
            type="button"
            className={`${styles.presetBtn} ${value === today ? styles.presetActive : ""}`}
            onClick={() => updateDate(today)}
          >
            วันนี้
          </button>
          <button
            type="button"
            className={`${styles.presetBtn} ${value === yesterday ? styles.presetActive : ""}`}
            onClick={() => updateDate(yesterday)}
          >
            เมื่อวาน
          </button>
          <button
            type="button"
            className={`${styles.presetBtn} ${value === sevenDaysAgo ? styles.presetActive : ""}`}
            onClick={() => updateDate(sevenDaysAgo)}
          >
            7 วันก่อน
          </button>
        </div>
      </div>

      <div className={styles.filterActions}>
        <button
          type="button"
          className={styles.stepBtn}
          title="วันก่อนหน้า"
          aria-label="วันก่อนหน้า"
          onClick={() => updateDate(addDays(value, -1))}
        >
          ‹
        </button>

        <ThaiDateInput key={value} label={label} value={value} onCommit={updateDate} />

        <button
          type="button"
          className={styles.stepBtn}
          title="วันถัดไป"
          aria-label="วันถัดไป"
          disabled={value >= today}
          onClick={() => updateDate(addDays(value, 1))}
        >
          ›
        </button>
      </div>
    </section>
  );
}

function parseYmd(val: string): { year: number; month: number; day: number } | null {
  const match = val.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10) - 1,
    day: parseInt(match[3], 10),
  };
}

function ThaiDateInput({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => boolean }) {
  const [draftDate, setDraftDate] = useState(toDisplayDate(value));
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const parsed = useMemo(() => parseYmd(value), [value]);
  const [viewYear, setViewYear] = useState(() => parsed?.year ?? new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => parsed?.month ?? new Date().getMonth());

  const [prevParsed, setPrevParsed] = useState(parsed);
  if (parsed !== prevParsed) {
    setPrevParsed(parsed);
    if (parsed) {
      setViewYear(parsed.year);
      setViewMonth(parsed.month);
    }
  }

  function commitDate() {
    const committed = onCommit(toApiDate(draftDate));
    if (!committed) setDraftDate(toDisplayDate(value));
  }

  const updateCoords = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const popoverWidth = 300;
    const popoverHeight = 350;
    const margin = 8;
    const padding = 12;

    let left = rect.right - popoverWidth;
    if (left + popoverWidth > window.innerWidth - padding) {
      left = window.innerWidth - padding - popoverWidth;
    }
    if (left < padding) {
      left = padding;
    }

    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    let top = rect.bottom + margin;

    if (spaceBelow < popoverHeight && spaceAbove >= popoverHeight) {
      top = rect.top - popoverHeight - margin;
    } else if (spaceBelow < popoverHeight) {
      top = Math.max(padding, window.innerHeight - popoverHeight - padding);
    }

    setCoords({ top, left });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updateCoords();

    const handleResizeOrScroll = () => {
      updateCoords();
    };

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    window.addEventListener("resize", handleResizeOrScroll);
    window.addEventListener("scroll", handleResizeOrScroll, true);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", handleResizeOrScroll);
      window.removeEventListener("scroll", handleResizeOrScroll, true);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, updateCoords]);

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function handleSelectDate(year: number, month: number, day: number) {
    const formatted = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    setDraftDate(toDisplayDate(formatted));
    onCommit(formatted);
    setIsOpen(false);
  }

  function handleSelectToday() {
    const today = todayDateInputValue();
    const p = parseYmd(today);
    if (p) {
      handleSelectDate(p.year, p.month, p.day);
    }
  }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
  const todayStr = todayDateInputValue();

  return (
    <div className={styles.dateInputGroup}>
      <input
        aria-label={label}
        inputMode="numeric"
        pattern="\d{2}/\d{2}/\d{4}"
        placeholder="DD/MM/YYYY"
        type="text"
        value={draftDate}
        onBlur={commitDate}
        onChange={(event) => setDraftDate(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
      <button
        ref={buttonRef}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="เปิดปฏิทิน"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1.5A2.5 2.5 0 0 1 22 6.5v12A2.5 2.5 0 0 1 19.5 21h-15A2.5 2.5 0 0 1 2 18.5v-12A2.5 2.5 0 0 1 4.5 4H6V3a1 1 0 0 1 1-1Zm12.5 8h-15v8.5a.5.5 0 0 0 .5.5h14a.5.5 0 0 0 .5-.5V10ZM5 6a.5.5 0 0 0-.5.5V8h15V6.5A.5.5 0 0 0 19 6H5Z" />
        </svg>
      </button>

      {isOpen && typeof document !== "undefined" && coords
        ? createPortal(
            <div
              ref={popoverRef}
              aria-label="เลือกวันที่"
              className={styles.calendarPopover}
              role="dialog"
              style={{ top: `${coords.top}px`, left: `${coords.left}px` }}
            >
              <div className={styles.calendarHeader}>
                <button
                  aria-label="เดือนก่อนหน้า"
                  className={styles.navBtn}
                  type="button"
                  onClick={prevMonth}
                >
                  <svg viewBox="0 0 24 24">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <div className={styles.calendarTitle}>
                  <span className={styles.calendarMonthYear}>
                    {THAI_MONTHS[viewMonth]} {viewYear}
                  </span>
                  <span className={styles.calendarBuddhistYear}>
                    พ.ศ. {viewYear + 543}
                  </span>
                </div>
                <button
                  aria-label="เดือนถัดไป"
                  className={styles.navBtn}
                  type="button"
                  onClick={nextMonth}
                >
                  <svg viewBox="0 0 24 24">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>

              <div className={styles.weekdays}>
                {THAI_WEEKDAYS.map((wd) => (
                  <span
                    key={wd.key}
                    className={`${styles.weekday} ${
                      wd.key === "sun"
                        ? styles.weekdaySun
                        : wd.key === "sat"
                        ? styles.weekdaySat
                        : ""
                    }`}
                  >
                    {wd.label}
                  </span>
                ))}
              </div>

              <div className={styles.daysGrid}>
                {Array.from({ length: firstDayIndex }).map((_, index) => (
                  <div key={`empty-${index}`} className={styles.emptyCell} />
                ))}
                {Array.from({ length: daysInMonth }).map((_, index) => {
                  const day = index + 1;
                  const dayStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const isToday = dayStr === todayStr;
                  const isSelected = dayStr === value;

                  return (
                    <button
                      key={day}
                      className={`${styles.dayCell} ${isToday ? styles.today : ""} ${
                        isSelected ? styles.selected : ""
                      }`}
                      type="button"
                      onClick={() => handleSelectDate(viewYear, viewMonth, day)}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>

              <div className={styles.calendarFooter}>
                <button
                  className={styles.todayBtn}
                  type="button"
                  onClick={handleSelectToday}
                >
                  วันนี้
                </button>
                <button
                  className={styles.closeBtn}
                  type="button"
                  onClick={() => setIsOpen(false)}
                >
                  ปิด
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function toDisplayDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function toApiDate(value: string): string {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return value;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

