import type { NextConfig } from "next";

// NEXT_OUTPUT=standalone emits a self-contained server in .next/standalone.
// The desktop app (desktop/) bundles that server; Vercel and Docker builds
// leave it unset and keep the default output.
const nextConfig: NextConfig = {
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
