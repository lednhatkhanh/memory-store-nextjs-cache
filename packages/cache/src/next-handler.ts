import { Redis } from "ioredis";

import { createCacheNamespace } from "./cache-namespace.ts";
import { createRedisCacheHandler } from "./index.ts";

const instance = process.env["CACHE_INSTANCE_ID"] ?? `pid:${process.pid}`;
const REDIS_READY_TIMEOUT_MILLISECONDS = 2_000;

const client = new Redis(process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379", {
  autoResendUnfulfilledCommands: false,
  commandTimeout: 1_000,
  connectTimeout: 1_000,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  reconnectOnError(error): boolean | 1 {
    return error.message.includes("READONLY") ? 1 : false;
  },
  retryStrategy(attempt): number {
    return Math.min(100 * 2 ** Math.min(attempt - 1, 4), 1_000);
  },
});

client.on("error", () => {
  // oxlint-disable-next-line no-console -- Connection diagnostics intentionally exclude error text and configuration.
  console.warn(JSON.stringify({ cache: "remote", event: "redis-connection-error", instance }));
});

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
    if (diagnostic.event === "cache-read") {
      // oxlint-disable-next-line no-console -- This runtime seam intentionally emits bounded diagnostics.
      console.info(JSON.stringify({ cache: "remote", instance, ...diagnostic }));
    } else {
      // oxlint-disable-next-line no-console -- This runtime seam intentionally emits bounded diagnostics.
      console.warn(JSON.stringify({ cache: "remote", instance, ...diagnostic }));
    }
  },
});

async function waitForRedisReady(): Promise<void> {
  if (client.status === "ready") return;
  if (client.status === "end") throw new Error("Redis connection is closed");

  await new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    let onEnd: () => void;
    let onReady: () => void;

    const cleanup = (): void => {
      clearTimeout(timeout);
      client.off("end", onEnd);
      client.off("ready", onReady);
    };
    onEnd = (): void => {
      cleanup();
      reject(new Error("Redis connection ended before becoming ready"));
    };
    onReady = (): void => {
      cleanup();
      resolve();
    };
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Redis connection did not become ready within the bounded deadline"));
    }, REDIS_READY_TIMEOUT_MILLISECONDS);

    client.once("end", onEnd);
    client.once("ready", onReady);
  });
}

export async function propagateRedisCacheInvalidation(
  tags: string[],
  durations?: { expire?: number },
): Promise<void> {
  await waitForRedisReady();
  await redisHandler.updateTags(tags, durations);
}

export default redisHandler;
