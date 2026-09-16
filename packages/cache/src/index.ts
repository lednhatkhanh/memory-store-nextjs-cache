import { createHash } from "node:crypto";

import { secondsToMilliseconds } from "date-fns/secondsToMilliseconds";
import { uniq } from "es-toolkit";
import type { Redis } from "ioredis";

import { decodeCacheEntry, encodeCacheEntry, type CacheEntry } from "./cache-entry-codec.js";
import { getCacheEntryFreshness, getCacheTagFreshness } from "./cache-entry-lifetime.js";

export {
  getCacheEntryFreshness,
  type CacheEntryFreshness,
  getCacheTagFreshness,
  type CacheTagTimestamps,
} from "./cache-entry-lifetime.js";

export type { CacheEntry, CacheEntryMetadata } from "./cache-entry-codec.js";

/** The package name is exported as a minimal executable workspace smoke seam. */
export const packageIdentity = "unicorn-nextjs-memory-cache";

export type RedisCacheHandler = {
  get(cacheKey: string, softTags: string[]): Promise<CacheEntry | undefined>;
  getExpiration(tags: string[]): Promise<number>;
  getResourceState(): RedisCacheResourceState;
  refreshTags(): Promise<void>;
  set(cacheKey: string, pendingEntry: Promise<CacheEntry>): Promise<void>;
  updateTags(tags: string[], durations?: { expire?: number }): Promise<void>;
};

export type RedisCacheResourceState = Readonly<{
  bufferedBytes: number;
  pendingWrites: number;
}>;

export type RedisCacheDiagnostic = Readonly<{
  event: "entry-rejected";
  limitBytes: number;
  observedBytes: number;
  reason: "buffer-limit" | "entry-size-limit";
}>;

export type RedisCacheHandlerOptions = {
  maxBufferedBytes?: number;
  maxEntrySizeBytes?: number;
  namespace: string;
  onDiagnostic?: (diagnostic: RedisCacheDiagnostic) => void;
};

const DEFAULT_MAX_ENTRY_SIZE_BYTES = 8 * 1_024 * 1_024;
const DEFAULT_MAX_BUFFERED_BYTES = 32 * 1_024 * 1_024;

const publishEntryScript = `
local candidateTimestamp = tonumber(ARGV[2])
local publishTimestamp = tonumber(ARGV[3])
local tagCount = tonumber(ARGV[5])

for index = 1, tagCount do
  local tag = ARGV[5 + index]
  local staleAt = redis.call("ZSCORE", KEYS[2], tag)
  local expiredAt = redis.call("ZSCORE", KEYS[3], tag)
  if (staleAt and tonumber(staleAt) >= candidateTimestamp)
    or (expiredAt
      and tonumber(expiredAt) <= publishTimestamp
      and tonumber(expiredAt) >= candidateTimestamp) then
    return 0
  end
end

local current = redis.call("GET", KEYS[1])
if current then
  local decodedOk, decoded = pcall(cjson.decode, current)
  local currentTimestamp = decodedOk
    and decoded.metadata
    and tonumber(decoded.metadata.timestamp)
  if currentTimestamp and currentTimestamp >= candidateTimestamp then
    return -1
  end
end

redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[4])
return 1
`;

const updateTagsScript = `
local updatedAt = tonumber(ARGV[1])
local expiresAt = ARGV[2] == "" and nil or tonumber(ARGV[2])
local hasDurations = ARGV[3] == "1"
local tagCount = tonumber(ARGV[4])

for index = 1, tagCount do
  local tag = ARGV[4 + index]
  local previousUpdate = redis.call("ZSCORE", KEYS[3], tag)
  if not previousUpdate or tonumber(previousUpdate) <= updatedAt then
    redis.call("ZADD", KEYS[3], updatedAt, tag)
    if hasDurations then
      redis.call("ZADD", KEYS[1], updatedAt, tag)
      if expiresAt then
        redis.call("ZADD", KEYS[2], expiresAt, tag)
      end
    else
      redis.call("ZADD", KEYS[2], updatedAt, tag)
    end
  end
end

return tagCount
`;

function redisKeySpace(namespace: string): string {
  const namespaceDigest = createHash("sha256").update(namespace).digest("hex").slice(0, 16);
  return `{memory-store:${namespaceDigest}}:${namespace}`;
}

function redisKey(keySpace: string, cacheKey: string): string {
  return `${keySpace}:entry:${cacheKey}`;
}

function redisTagKey(keySpace: string, state: "expired" | "stale" | "updated"): string {
  return `${keySpace}:tag:${state}`;
}

function nowInEpochMilliseconds(): number {
  return performance.timeOrigin + performance.now();
}

async function getTagTimestamps(
  client: Redis,
  key: string,
  tags: string[],
): Promise<(number | null)[]> {
  if (tags.length === 0) return [];
  const scores = await client.zmscore(key, tags);
  return scores.map((score) => (score === null ? null : Number(score)));
}

function configuredByteLimit(value: number | undefined, fallback: number, name: string): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return limit;
}

export function createRedisCacheHandler(
  client: Redis,
  options: RedisCacheHandlerOptions,
): RedisCacheHandler {
  if (options.namespace.trim().length === 0) {
    throw new Error("Redis cache namespace must not be empty");
  }

  const keySpace = redisKeySpace(options.namespace);
  const maxEntrySizeBytes = configuredByteLimit(
    options.maxEntrySizeBytes,
    DEFAULT_MAX_ENTRY_SIZE_BYTES,
    "maxEntrySizeBytes",
  );
  const maxBufferedBytes = configuredByteLimit(
    options.maxBufferedBytes,
    DEFAULT_MAX_BUFFERED_BYTES,
    "maxBufferedBytes",
  );
  const pendingSets = new Map<string, Promise<void>>();
  let bufferedBytes = 0;

  const rejectEntry = (
    reason: RedisCacheDiagnostic["reason"],
    observedBytes: number,
    limitBytes: number,
  ): Error => {
    try {
      options.onDiagnostic?.({ event: "entry-rejected", limitBytes, observedBytes, reason });
    } catch {
      // Diagnostics are observational and must not replace the deterministic cache rejection.
    }
    return new Error(`Redis cache entry rejected: ${reason}`);
  };

  const serializeEntry = async (
    entry: CacheEntry,
  ): Promise<{ release: () => void; stored: string }> => {
    const metadata = {
      expire: entry.expire,
      revalidate: entry.revalidate,
      stale: entry.stale,
      tags: entry.tags,
      timestamp: entry.timestamp,
    };
    const metadataSizeBytes = Buffer.byteLength(JSON.stringify(metadata));
    if (metadataSizeBytes > maxEntrySizeBytes) {
      throw rejectEntry("entry-size-limit", metadataSizeBytes, maxEntrySizeBytes);
    }
    const chunks: Uint8Array[] = [];
    const reader = entry.value.getReader();
    let entrySizeBytes = metadataSizeBytes;
    let valueSizeBytes = 0;
    let retainedBytes = 0;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      bufferedBytes -= retainedBytes;
    };

    try {
      while (true) {
        // oxlint-disable-next-line no-await-in-loop -- Stream chunks must be read sequentially.
        const chunk = await reader.read();
        if (chunk.done) break;
        const nextEntrySizeBytes = entrySizeBytes + chunk.value.byteLength;
        if (nextEntrySizeBytes > maxEntrySizeBytes) {
          const error = rejectEntry("entry-size-limit", nextEntrySizeBytes, maxEntrySizeBytes);
          // oxlint-disable-next-line no-await-in-loop -- Cancellation completes before rejection.
          await Promise.allSettled([reader.cancel(error)]);
          throw error;
        }
        const nextBufferedBytes = bufferedBytes + chunk.value.byteLength;
        if (nextBufferedBytes > maxBufferedBytes) {
          const error = rejectEntry("buffer-limit", nextBufferedBytes, maxBufferedBytes);
          // oxlint-disable-next-line no-await-in-loop -- Cancellation completes before rejection.
          await Promise.allSettled([reader.cancel(error)]);
          throw error;
        }
        entrySizeBytes = nextEntrySizeBytes;
        valueSizeBytes += chunk.value.byteLength;
        retainedBytes += chunk.value.byteLength;
        bufferedBytes = nextBufferedBytes;
        chunks.push(chunk.value);
      }
      const value = Buffer.concat(
        chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
        valueSizeBytes,
      );
      return {
        release,
        stored: encodeCacheEntry(metadata, value),
      };
    } catch (error) {
      release();
      throw error;
    } finally {
      reader.releaseLock();
    }
  };

  return {
    async get(cacheKey, softTags): Promise<CacheEntry | undefined> {
      try {
        await pendingSets.get(cacheKey);
      } catch {
        // The failed replacement was never published; fall back to the last complete value.
      }
      const stored = await client.get(redisKey(keySpace, cacheKey));
      let entry: CacheEntry | undefined;
      if (stored !== null) {
        const restored = decodeCacheEntry(stored);
        if (!restored) return entry;
        const now = nowInEpochMilliseconds();
        if (getCacheEntryFreshness(restored, now) === "expired") return entry;
        const tags = uniq([...restored.tags, ...softTags]);
        const [expiredAt, staleAt] = await Promise.all([
          getTagTimestamps(client, redisTagKey(keySpace, "expired"), tags),
          getTagTimestamps(client, redisTagKey(keySpace, "stale"), tags),
        ]);
        const tagFreshness = getCacheTagFreshness(
          restored.timestamp,
          now,
          tags.map((_, index) => ({
            expiredAt: expiredAt[index] ?? null,
            staleAt: staleAt[index] ?? null,
          })),
        );

        if (tagFreshness !== "expired") {
          const revalidate = tagFreshness === "stale" ? -1 : restored.revalidate;
          entry = { ...restored, revalidate };
        }
      }
      return entry;
    },
    async getExpiration(tags): Promise<number> {
      const timestamps = await getTagTimestamps(client, redisTagKey(keySpace, "expired"), tags);
      return Math.max(
        0,
        ...timestamps.filter((timestamp): timestamp is number => timestamp !== null),
      );
    },
    getResourceState(): RedisCacheResourceState {
      return { bufferedBytes, pendingWrites: pendingSets.size };
    },
    async refreshTags(): Promise<void> {
      return;
    },
    async set(cacheKey, pendingEntry): Promise<void> {
      const write = (async (): Promise<void> => {
        const entry = await pendingEntry;
        const serialized = await serializeEntry(entry);
        try {
          await client.eval(
            publishEntryScript,
            3,
            redisKey(keySpace, cacheKey),
            redisTagKey(keySpace, "stale"),
            redisTagKey(keySpace, "expired"),
            serialized.stored,
            entry.timestamp,
            nowInEpochMilliseconds(),
            Math.max(1, Math.ceil(entry.expire)),
            entry.tags.length,
            ...entry.tags,
          );
        } finally {
          serialized.release();
        }
      })();
      pendingSets.set(cacheKey, write);
      try {
        await write;
      } finally {
        if (pendingSets.get(cacheKey) === write) {
          pendingSets.delete(cacheKey);
        }
      }
    },
    async updateTags(tags, durations): Promise<void> {
      const uniqueTags = uniq(tags);
      if (uniqueTags.length === 0) return;

      const now = nowInEpochMilliseconds();
      const expiresAt =
        typeof durations?.expire === "number" ? now + secondsToMilliseconds(durations.expire) : "";
      await client.eval(
        updateTagsScript,
        3,
        redisTagKey(keySpace, "stale"),
        redisTagKey(keySpace, "expired"),
        redisTagKey(keySpace, "updated"),
        now,
        expiresAt,
        durations ? 1 : 0,
        uniqueTags.length,
        ...uniqueTags,
      );
    },
  };
}
