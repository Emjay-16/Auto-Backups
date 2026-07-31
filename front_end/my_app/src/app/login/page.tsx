"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import styles from "@/styles/pages/login/login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const result = await signIn("credentials", {
      user_name: userName.trim(),
      password,
      redirect: false,
    });

    setSaving(false);

    if (!result?.ok) {
      setError("Username หรือ password ไม่ถูกต้อง");
      return;
    }

    router.replace("/");
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
              placeholder="admin"
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

          <button disabled={saving || !userName.trim() || !password} type="submit">
            {saving ? "กำลังเข้าสู่ระบบ..." : "Login"}
          </button>
        </form>
      </section>
    </main>
  );
}
