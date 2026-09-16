import { createRequire } from "node:module";

import type { NextConfig } from "next";

const require = createRequire(import.meta.url);

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  cacheLife: {
    briefStaleContentRefresh: {
      expire: 2,
      revalidate: 1,
      stale: 30,
    },
    publishedContent: {
      expire: 86_400,
      revalidate: 3_600,
      stale: 300,
    },
  },
  cacheHandlers: {
    remote: require.resolve("unicorn-nextjs-memory-cache/next-handler"),
  },
  partialPrefetching: true,
  logging: {
    browserToTerminal: true,
  },
  reactCompiler: true,
  experimental: {
    turbopackRustReactCompiler: true,
  },
};

export default nextConfig;
