import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Preview archives and local credentials are never runtime production assets.
  outputFileTracingExcludes: {
    "/*": ["./.local/**/*", "./.env*", "./.git", "./.git/**/*", "./tests/**/*", "./docs/**/*"],
  },
  turbopack: {
    root: process.cwd()
  }
};

export default nextConfig;
