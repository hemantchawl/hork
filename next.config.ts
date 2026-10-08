import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ship the JSON data with every server function: it's the read source locally, and the seed for
  // Vercel Blob the first time each collection is read there.
  outputFileTracingIncludes: { "/**/*": ["./data/*.json"] },
  outputFileTracingExcludes: { "/**/*": ["./data/cache/**", "./data/uploads/**", "./data/backups/**"] },
};

export default nextConfig;
