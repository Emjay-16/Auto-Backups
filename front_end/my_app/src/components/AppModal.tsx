"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "@/styles/components/AppModal.module.css";

type AppModalProps = {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
  bodyClassName?: string;
  labelledBy?: string;
};

const emptySubscribe = () => () => {};

export function AppModal({
  title,
  eyebrow,
  children,
  footer,
  onClose,
  className = "",
  bodyClassName = "",
  labelledBy = "app-modal-title",
}: AppModalProps) {
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (mounted && modalRef.current) {
      const focusable = modalRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      focusable?.focus();
    }
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div aria-hidden="true" className={styles.backdrop} onClick={onClose} />
      <section ref={modalRef} className={`${styles.modal} ${className}`}>
        <header className={styles.header}>
          <div>
            {eyebrow ? <p>{eyebrow}</p> : null}
            <h2 id={labelledBy}>{title}</h2>
          </div>
          <button className={styles.closeButton} onClick={onClose} aria-label="Close" type="button">
            ×
          </button>
        </header>
        <div className={`${styles.body} ${bodyClassName}`}>{children}</div>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}
