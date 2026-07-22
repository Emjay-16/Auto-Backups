import Link from "next/link";
import styles from "@/styles/pages/login/login.module.css";

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <span>AB</span>
          <div>
            <strong>Auto Backup</strong>
            <p>Authentication is disabled</p>
          </div>
        </div>
        <div className={styles.form}>
          <div>
            <h1>เข้าสู่ระบบไม่จำเป็นแล้ว</h1>
          </div>
          <Link href="/">กลับหน้า Dashboard</Link>
        </div>
      </section>
    </main>
  );
}
