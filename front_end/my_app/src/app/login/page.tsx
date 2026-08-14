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
    router.refresh();
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
  const callbackUrl = new URLSearchParams(window.location.search).get("callbackUrl");
  if (!callbackUrl || !callbackUrl.startsWith("/") || callbackUrl.startsWith("//")) return "/";
  return callbackUrl;
}
