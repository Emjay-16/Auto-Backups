"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import styles from "@/styles/components/DateFilter.module.css";

type DateFilterProps = {
  value: string;
  label: string;
};

export function DateFilter({ value, label }: DateFilterProps) {
  const router = useRouter();
  const pathname = usePathname();

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
        <small>แสดงข้อมูลตามวันที่เลือก</small>
      </div>
      <ThaiDateInput key={value} label={label} value={value} onCommit={updateDate} />
    </section>
  );
}

function ThaiDateInput({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => boolean }) {
  const nativeInputRef = useRef<HTMLInputElement | null>(null);
  const [draftDate, setDraftDate] = useState(toDisplayDate(value));

  function commitDate() {
    const committed = onCommit(toApiDate(draftDate));
    if (!committed) setDraftDate(toDisplayDate(value));
  }

  function selectNativeDate(nextValue: string) {
    setDraftDate(toDisplayDate(nextValue));
    onCommit(nextValue);
  }

  function openCalendar() {
    const input = nativeInputRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
    input.click();
  }

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
      <button aria-label="เปิดปฏิทิน" type="button" onClick={openCalendar}>
        <span aria-hidden="true">🗓</span>
      </button>
      <input
        ref={nativeInputRef}
        aria-hidden="true"
        className={styles.nativeDateInput}
        tabIndex={-1}
        type="date"
        value={value}
        onChange={(event) => selectNativeDate(event.target.value)}
      />
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
