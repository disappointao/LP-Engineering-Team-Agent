import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: join(appDir, "../.."),
  transpilePackages: [
    "@lp-agent/api",
    "@lp-agent/artifacts",
    "@lp-agent/lp-schema"
  ]
};

export default nextConfig;
