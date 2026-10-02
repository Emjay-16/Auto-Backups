"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import styles from "@/styles/components/ToastProvider.module.css";

type ToastTone = "success" | "error" | "warning" | "info";

type Toast = {
  id: number;
  title: string;
  message?: string;
  tone: ToastTone;
};

type ToastContextValue = {
  showToast: (toast: Omit<Toast, "id">) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idCounter = useRef(0);
  const timers = useRef<Map<number, number>>(new Map());

  const removeToast = useCallback((id: number) => {
    const existingTimer = timers.current.get(id);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((toast: Omit<Toast, "id">) => {
    idCounter.current += 1;
    const id = Date.now() * 1000 + idCounter.current;
    setToasts((current) => [...current.slice(-4), { ...toast, id }]);
    const timeoutId = window.setTimeout(
      () => removeToast(id),
      toast.tone === "error" ? 6500 : 4200,
    );
    timers.current.set(id, timeoutId);
  }, [removeToast]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.toasts} aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <article className={`${styles.toast} ${styles[toast.tone]}`} key={toast.id} role={toast.tone === "error" ? "alert" : "status"}>
            <span className={styles.icon} aria-hidden="true" />
            <div className={styles.content}>
              <strong>{toast.title}</strong>
              {toast.message ? <p>{toast.message}</p> : null}
            </div>
            <button onClick={() => removeToast(toast.id)} aria-label="Dismiss notification" type="button">×</button>
          </article>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return context;
}
