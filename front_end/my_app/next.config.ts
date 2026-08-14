import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  allowedDevOrigins: ["172.30.39.6"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
