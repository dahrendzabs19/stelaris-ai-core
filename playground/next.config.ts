import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The playground consumes @stelaris/ai-core via the "file:.." dependency.
  // No special transpilation or aliasing is needed — the package is built
  // to an ESM bundle in the parent project's dist/ directory.
};

export default nextConfig;