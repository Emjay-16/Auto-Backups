import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const DEFAULT_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

type BackendLoginResponse = {
  user_id: number;
  user_name: string;
  role: number;
  access_token: string;
  token_type: string;
  message: string;
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: sessionMaxAgeSeconds(),
  },
  jwt: {
    maxAge: sessionMaxAgeSeconds(),
  },
  providers: [
    Credentials({
      credentials: {
        user_name: {},
        password: {},
      },
      async authorize(credentials) {
        const userName = String(credentials?.user_name ?? "").trim();
        const password = String(credentials?.password ?? "");
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
        });

        if (!response.ok) return null;

        const data = await response.json() as BackendLoginResponse;
        return {
          id: String(data.user_id),
          name: data.user_name,
          role: data.role,
          accessToken: data.access_token,
          tokenType: data.token_type,
        };
      },
    }),
  ],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = Boolean(auth?.user);
      const isLoginPage = request.nextUrl.pathname === "/login";
      if (isLoginPage) return true;
      return isLoggedIn;
    },
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.role = user.role;
        token.accessToken = user.accessToken;
        token.tokenType = user.tokenType;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = String(token.userId ?? "");
      session.user.role = Number(token.role ?? 0);
      session.accessToken = String(token.accessToken ?? "");
      session.tokenType = String(token.tokenType ?? "bearer");
      return session;
    },
  },
});

function sessionMaxAgeSeconds(): number {
  const hours = Number(process.env.JWT_ACCESS_TOKEN_EXPIRE_HOURS);
  if (Number.isFinite(hours) && hours > 0) return Math.floor(hours * 60 * 60);

  const minutes = Number(process.env.JWT_ACCESS_TOKEN_EXPIRE_MINUTES);
  if (Number.isFinite(minutes) && minutes > 0) return Math.floor(minutes * 60);

  return DEFAULT_SESSION_MAX_AGE_SECONDS;
}
