import { Redis } from "ioredis";

import { createCacheNamespace, createRedisCacheHandler, type RedisCacheHandler } from "./index.ts";

const client = new Redis(process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379", {
  lazyConnect: true,
});

const instance = process.env["CACHE_INSTANCE_ID"] ?? `pid:${process.pid}`;

function optionalByteLimit(name: string): number | null {
  const value = process.env[name];
  return typeof value === "string" ? Number(value) : null;
}

const maxBufferedBytes = optionalByteLimit("REDIS_CACHE_MAX_BUFFERED_BYTES");
const maxEntrySizeBytes = optionalByteLimit("REDIS_CACHE_MAX_ENTRY_SIZE_BYTES");
const redisHandler = createRedisCacheHandler(client, {
  ...(maxBufferedBytes === null ? {} : { maxBufferedBytes }),
  ...(maxEntrySizeBytes === null ? {} : { maxEntrySizeBytes }),
  namespace: createCacheNamespace({
    application: process.env["REDIS_CACHE_NAMESPACE"] ?? "memory-store-nextjs-cache",
    environment: process.env["REDIS_CACHE_ENVIRONMENT"] ?? "development",
    locale: process.env["REDIS_CACHE_LOCALE"] ?? "en",
    release: process.env["REDIS_CACHE_RELEASE"] ?? "local",
    site: process.env["REDIS_CACHE_SITE"] ?? "reference",
  }),
  onDiagnostic(diagnostic) {
    // oxlint-disable-next-line no-console -- This runtime seam intentionally emits bounded diagnostics.
    console.warn(JSON.stringify({ cache: "remote", instance, ...diagnostic }));
  },
});

const handler: RedisCacheHandler = {
  ...redisHandler,
  async get(cacheKey, softTags) {
    const entry = await redisHandler.get(cacheKey, softTags);
    // oxlint-disable-next-line no-console -- This runtime seam intentionally emits cache diagnostics.
    console.info(JSON.stringify({ cache: "remote", instance, result: entry ? "hit" : "miss" }));
    return entry;
  },
};

export default handler;
