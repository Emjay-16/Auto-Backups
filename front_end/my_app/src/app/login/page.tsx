"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { clearClientAccessTokenCache } from "@/lib/api";
import styles from "@/styles/pages/login/login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userName.trim() || !password) {
      setError("กรอกชื่อผู้ใช้และรหัสผ่านก่อน");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const result = await signIn("credentials", {
        redirect: false,
        user_name: userName.trim(),
        password,
      });

      if (result?.error) {
        setError("ชื่อ หรือ รหัสไม่ถูกต้อง");
        return;
      }

      clearClientAccessTokenCache();
      router.replace("/");
      router.refresh();
    } catch (errorResponse) {
      setError(errorResponse instanceof Error ? errorResponse.message : "Login failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <span>AB</span>
          <div>
            <strong>Auto Backup</strong>
            <p>Robot fleet manager</p>
          </div>
        </div>

        <form className={styles.form} onSubmit={submitLogin}>
          <div>
            <h1>เข้าสู่ระบบ</h1>
          </div>

          <label>
            Username
            <input
              autoComplete="username"
              autoFocus
              value={userName}
              onChange={(event) => setUserName(event.target.value)}
              placeholder="users"
            />
          </label>

          <label>
            Password
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="password"
            />
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}

          <button disabled={saving} type="submit">
            {saving ? "กำลังเข้าสู่ระบบ..." : "Login"}
          </button>
        </form>
      </section>
    </main>
  );
}
