import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken: string;
    tokenType: string;
    user: DefaultSession["user"] & {
      id: string;
      role: number;
    };
  }

  interface User {
    role: number;
    accessToken: string;
    tokenType: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    role?: number;
    accessToken?: string;
    tokenType?: string;
  }
}
