import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { AuthSessionProvider } from "@/components/AuthSessionProvider";
import { ToastProvider } from "@/components/ToastProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auto Backup System",
  description: "Robot fleet backup and restore manager",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body>
        <AuthSessionProvider>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
