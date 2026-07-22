"use client";

import styles from "@/styles/components/PaginationControls.module.css";

type PaginationControlsProps = {
  page: number;
  pageSize: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
};

export function PaginationControls({ page, pageSize, total, onPrevious, onNext }: PaginationControlsProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);

  return (
    <div className={styles.pagination}>
      <span>
        Showing {start}-{end} of {total}
      </span>
      <div>
        <button onClick={onPrevious} disabled={page === 0}>
          Previous
        </button>
        <strong>
          {page + 1} / {pageCount}
        </strong>
        <button onClick={onNext} disabled={page >= pageCount - 1}>
          Next
        </button>
      </div>
    </div>
  );
}
