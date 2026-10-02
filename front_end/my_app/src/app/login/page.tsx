"use client";

import { useEffect, useState, type FormEvent } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import styles from "@/styles/pages/login/login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const { status } = useSession();
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const canSubmit = userName.trim().length > 0 && password.length > 0 && !saving;

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(getSafeCallbackUrl());
    }
  }, [router, status]);

  if (status === "loading") {
    return (
      <div className={styles.page}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
          <span style={{ color: "var(--muted)" }}>กำลังตรวจสอบ...</span>
        </div>
      </div>
    );
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      setError("กรุณากรอก Username และ Password ให้ครบ");
      return;
    }

    setSaving(true);
    setError("");

    const result = await signIn("credentials", {
      user_name: userName.trim(),
      password,
      redirect: false,
    });

    setSaving(false);

    if (!result?.ok) {
      const reason = result?.error ?? "UNKNOWN_ERROR";
      const friendlyMessage =
        reason === "CredentialsSignin"
          ? "Username หรือ password ไม่ถูกต้อง"
          : reason === "Configuration"
            ? "การตั้งค่า Login ไม่ถูกต้อง กรุณาติดต่อผู้ดูแล"
            : reason === "AccessDenied"
              ? "การเข้าสู่ระบบถูกปฏิเสธ กรุณาตรวจสอบสิทธิ์"
              : reason === "CallbackRouteError"
                ? "เกิดข้อผิดพลาดระหว่างตรวจสอบข้อมูลผู้ใช้"
                : `ข้อผิดพลาดในการเข้าสู่ระบบ: ${reason}`;

      setError(friendlyMessage);
      return;
    }

    router.replace(getSafeCallbackUrl());
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <span>AB</span>
          <div>
            <p>Auto Backup System</p>
            <h1>เข้าสู่ระบบ</h1>
          </div>
        </div>

        <form className={styles.form} onSubmit={submitLogin}>
          <label>
            Username
            <input
              type="text"
              autoComplete="username"
              autoFocus
              onChange={(event) => setUserName(event.target.value)}
              placeholder="username"
              value={userName}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="password"
              type="password"
              value={password}
            />
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}

          <button disabled={!canSubmit} type="submit">
            {saving ? "กำลังเข้าสู่ระบบ..." : "Login"}
          </button>
        </form>
      </section>
    </main>
  );
}

function getSafeCallbackUrl(): string {
  if (typeof window === "undefined") return "/";
  try {
    const raw = new URLSearchParams(window.location.search).get("callbackUrl") ?? "/";
    const decoded = decodeURIComponent(raw);
    const url = new URL(decoded, window.location.origin);
    if (url.origin === window.location.origin) {
      return url.pathname + url.search + url.hash;
    }
  } catch {
    // ignore
  }
  return "/";
}
