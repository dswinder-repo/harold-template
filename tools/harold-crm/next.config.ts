import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Demo mode is decided at build time. Defaulting the flag to '0' lets the
  // bundler see a constant and drop the demo client and its fixtures from any
  // normal build. Run `pnpm dev:demo` (NEXT_PUBLIC_DEMO_MODE=1) to turn it on.
  env: {
    NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE ?? "0",
  },
};

export default nextConfig;
