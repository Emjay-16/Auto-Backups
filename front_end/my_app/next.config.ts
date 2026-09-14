import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: "standalone",
  allowedDevOrigins: ["172.30.39.6"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
