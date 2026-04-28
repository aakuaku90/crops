import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  // `standalone` emits a minimal node bundle to .next/standalone with a
  // built-in `server.js`. The production Dockerfile copies just that subtree
  // (plus public/ and .next/static), keeping the runtime image small.
  output: "standalone",
};

export default nextConfig;
