import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type BackendLoginResponse = {
  user_id: number;
  user_name: string;
  role: number;
  message: string;
};

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: getSessionMaxAgeSeconds(),
    updateAge: 0,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Auto Backup Login",
      credentials: {
        user_name: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const userName = credentials?.user_name?.trim();
        const password = credentials?.password;

        if (!userName || !password) return null;

        const response = await fetch(`${API_URL}/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_name: userName,
            password,
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });

        if (!response.ok) return null;

        const data = await response.json() as BackendLoginResponse;

        return {
          id: String(data.user_id),
          name: data.user_name,
          role: data.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.id ?? "");
        session.user.role = Number(token.role ?? 0);
      }
      return session;
    },
  },
};

function getSessionMaxAgeSeconds(): number {
  const hours = Number(process.env.NEXTAUTH_SESSION_HOURS);
  if (Number.isFinite(hours) && hours > 0) return Math.round(hours * 60 * 60);

  const minutes = Number(process.env.NEXTAUTH_SESSION_MINUTES ?? 180);
  if (Number.isFinite(minutes) && minutes > 0) return Math.round(minutes * 60);

  return 3 * 60 * 60;
}
