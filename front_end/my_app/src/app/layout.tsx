import type { Metadata } from "next";
import { auth } from "@/auth";
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
  const session = await auth();

  return (
    <html lang="th">
      <body>
        <AuthSessionProvider session={session}>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
