"use client";

import { type ReactNode } from "react";
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
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <button className={styles.backdrop} onClick={onClose} aria-label="Close" />
      <section className={`${styles.modal} ${className}`}>
        <header className={styles.header}>
          <div>
            {eyebrow ? <p>{eyebrow}</p> : null}
            <h2 id={labelledBy}>{title}</h2>
          </div>
          <button className={styles.closeButton} onClick={onClose} aria-label="Close">
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
