import { createHash } from "node:crypto";

import { secondsToMilliseconds } from "date-fns/secondsToMilliseconds";
import { uniq } from "es-toolkit";
import type { Redis } from "ioredis";

import { decodeCacheEntry, encodeCacheEntry, type CacheEntry } from "./cache-entry-codec.ts";
import { getCacheEntryFreshness, getCacheTagFreshness } from "./cache-entry-lifetime.ts";

export {
  getCacheEntryFreshness,
  type CacheEntryFreshness,
  type CacheTagFreshness,
  getCacheTagFreshness,
  type CacheTagTimestamps,
} from "./cache-entry-lifetime.ts";

export type { CacheEntry, CacheEntryMetadata } from "./cache-entry-codec.ts";

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

export type RedisCacheDiagnostic =
  | Readonly<{
      event: "entry-rejected";
      limitBytes: number;
      observedBytes: number;
      reason: "buffer-limit" | "entry-size-limit";
    }>
  | Readonly<{
      event: "safety-miss";
      operation: "read" | "write";
      reason: "tag-metadata-absent" | "tag-metadata-incompatible";
    }>;

export type RedisCacheHandlerOptions = {
  maxBufferedBytes?: number;
  maxEntrySizeBytes?: number;
  namespace: string;
  onDiagnostic?: (diagnostic: RedisCacheDiagnostic) => void;
};

const DEFAULT_MAX_ENTRY_SIZE_BYTES = 8 * 1_024 * 1_024;
const DEFAULT_MAX_BUFFERED_BYTES = 32 * 1_024 * 1_024;
const PENDING_TAG_RETENTION_MILLISECONDS = 60_000;

const publishEntryScript = `
local candidateTimestamp = tonumber(ARGV[2])
local publishTimestamp = tonumber(ARGV[3])
local tagCount = tonumber(ARGV[5])
local tags = {}
local seenTags = {}

for index = 1, tagCount do
  local tag = ARGV[5 + index]
  if not seenTags[tag] then
    table.insert(tags, tag)
    seenTags[tag] = true
  end
end
for _, tag in ipairs(redis.call("SMEMBERS", KEYS[7])) do
  if not seenTags[tag] then
    table.insert(tags, tag)
    seenTags[tag] = true
  end
end

for _, tag in ipairs(tags) do
  local staleAt = redis.call("ZSCORE", KEYS[2], tag)
  local expiredAt = redis.call("ZSCORE", KEYS[3], tag)
  local updatedAt = redis.call("ZSCORE", KEYS[4], tag)
  local retainedUntil = redis.call("ZSCORE", KEYS[5], tag)
  local stateCount = (staleAt and 1 or 0)
    + (expiredAt and 1 or 0)
    + (updatedAt and 1 or 0)
    + (retainedUntil and 1 or 0)
  if stateCount == 0 then
    local metadataFloor = tonumber(redis.call("GET", KEYS[6]) or "0")
    if metadataFloor >= candidateTimestamp then
      return -3
    end
    redis.call("ZADD", KEYS[2], 0, tag)
    redis.call("ZADD", KEYS[3], 0, tag)
    redis.call("ZADD", KEYS[4], 0, tag)
  elseif stateCount ~= 4 then
    return -2
  end
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
local retainedUntil = publishTimestamp + (tonumber(ARGV[4]) * 1000)
for _, tag in ipairs(tags) do
  redis.call("ZADD", KEYS[5], "GT", retainedUntil, tag)
end
redis.call("DEL", KEYS[7])
return 1
`;

const updateTagsScript = `
local updatedAt = tonumber(ARGV[1])
local expiresAt = ARGV[2] == "" and nil or tonumber(ARGV[2])
local hasDurations = ARGV[3] == "1"
local tagCount = tonumber(ARGV[4])

local metadataFloor = tonumber(redis.call("GET", KEYS[5]) or "0")
if metadataFloor < updatedAt then
  redis.call("SET", KEYS[5], updatedAt)
end

for index = 1, tagCount do
  local tag = ARGV[4 + index]
  local previousUpdate = redis.call("ZSCORE", KEYS[3], tag)
  if not previousUpdate or tonumber(previousUpdate) <= updatedAt then
    redis.call("ZADD", KEYS[3], updatedAt, tag)
    redis.call("ZADD", KEYS[1], "NX", 0, tag)
    redis.call("ZADD", KEYS[2], "NX", 0, tag)
    redis.call("ZADD", KEYS[4], "NX", updatedAt, tag)
    if hasDurations then
      redis.call("ZADD", KEYS[1], updatedAt, tag)
      if expiresAt then
        redis.call("ZADD", KEYS[2], expiresAt, tag)
      end
    else
      redis.call("ZADD", KEYS[2], updatedAt, tag)
    end
    redis.call("ZADD", KEYS[4], "GT", expiresAt or updatedAt, tag)
  end
end

return tagCount
`;

const cleanupTagMetadataScript = `
local cleanupAt = tonumber(ARGV[1])
local tags = redis.call("ZRANGEBYSCORE", KEYS[4], "-inf", cleanupAt)
if #tags == 0 then
  return 0
end

local metadataFloor = tonumber(redis.call("GET", KEYS[5]) or "0")
if metadataFloor < cleanupAt then
  redis.call("SET", KEYS[5], cleanupAt)
end
for _, tag in ipairs(tags) do
  redis.call("ZREM", KEYS[1], tag)
  redis.call("ZREM", KEYS[2], tag)
  redis.call("ZREM", KEYS[3], tag)
  redis.call("ZREM", KEYS[4], tag)
end
return #tags
`;

const readTagMetadataScript = `
local tagCount = tonumber(ARGV[1])
local result = { redis.call("GET", KEYS[5]) or "0" }
for index = 1, tagCount do
  local tag = ARGV[1 + index]
  for keyIndex = 1, 4 do
    local score = redis.call("ZSCORE", KEYS[keyIndex], tag)
    table.insert(result, score or false)
  end
end
return result
`;

const ensureTagMetadataScript = `
local fenceTimestamp = tonumber(ARGV[1])
local retainedUntil = tonumber(ARGV[2])
local tagCount = tonumber(ARGV[3])
local metadataFloor = tonumber(redis.call("GET", KEYS[5]) or "0")
if metadataFloor >= fenceTimestamp then
  return -1
end

for index = 1, tagCount do
  local tag = ARGV[3 + index]
  local stateCount = 0
  for keyIndex = 1, 4 do
    if redis.call("ZSCORE", KEYS[keyIndex], tag) then
      stateCount = stateCount + 1
    end
  end
  if stateCount == 0 then
    redis.call("ZADD", KEYS[1], 0, tag)
    redis.call("ZADD", KEYS[2], 0, tag)
    redis.call("ZADD", KEYS[3], 0, tag)
    redis.call("ZADD", KEYS[4], retainedUntil, tag)
  elseif stateCount ~= 4 then
    return -2
  else
    redis.call("ZADD", KEYS[4], "GT", retainedUntil, tag)
  end
end
return 1
`;

function redisKeySpace(namespace: string): string {
  const namespaceDigest = createHash("sha256").update(namespace).digest("hex").slice(0, 16);
  return `{memory-store:${namespaceDigest}}:${namespace}`;
}

function redisKey(keySpace: string, cacheKey: string): string {
  return `${keySpace}:entry:${cacheKey}`;
}

type RedisTagState = "expired" | "retained" | "stale" | "updated";

function redisTagKey(keySpace: string, state: RedisTagState): string {
  return `${keySpace}:tag:${state}`;
}

function redisMetadataFloorKey(keySpace: string): string {
  return `${keySpace}:metadata-floor`;
}

function redisPendingTagsKey(keySpace: string, cacheKey: string): string {
  return `${keySpace}:pending-tags:${cacheKey}`;
}

function nowInEpochMilliseconds(): number {
  return performance.timeOrigin + performance.now();
}

async function getTagMetadata(
  client: Redis,
  keySpace: string,
  tags: string[],
): Promise<{
  issue: "tag-metadata-absent" | "tag-metadata-incompatible" | null;
  issues: Array<"tag-metadata-absent" | "tag-metadata-incompatible" | null>;
  metadataFloor: number;
  timestamps: Array<{ expiredAt: number | null; staleAt: number | null } | null>;
}> {
  const raw = await client.eval(
    readTagMetadataScript,
    5,
    redisTagKey(keySpace, "expired"),
    redisTagKey(keySpace, "stale"),
    redisTagKey(keySpace, "updated"),
    redisTagKey(keySpace, "retained"),
    redisMetadataFloorKey(keySpace),
    tags.length,
    ...tags,
  );
  if (!Array.isArray(raw) || raw.length !== 1 + tags.length * 4) {
    return {
      issue: "tag-metadata-incompatible",
      issues: tags.map(() => "tag-metadata-incompatible"),
      metadataFloor: Number.POSITIVE_INFINITY,
      timestamps: tags.map(() => null),
    };
  }
  const metadataFloor = Number(raw[0]);
  let issue: "tag-metadata-absent" | "tag-metadata-incompatible" | null = null;
  const issues: Array<"tag-metadata-absent" | "tag-metadata-incompatible" | null> = [];
  const timestamps = tags.map((_, index) => {
    const offset = 1 + index * 4;
    const values = raw
      .slice(offset, offset + 4)
      .map((value) =>
        typeof value === "string" || typeof value === "number" ? Number(value) : null,
      );
    const presentCount = values.filter((value) => value !== null).length;
    if (presentCount === 4) {
      issues.push(null);
      return { expiredAt: values[0] ?? null, staleAt: values[1] ?? null };
    }
    if (presentCount === 0) {
      issue ??= "tag-metadata-absent";
      issues.push("tag-metadata-absent");
    } else {
      issue = "tag-metadata-incompatible";
      issues.push("tag-metadata-incompatible");
    }
    return null;
  });
  return { issue, issues, metadataFloor, timestamps };
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

  const emitDiagnostic = (diagnostic: RedisCacheDiagnostic): void => {
    try {
      options.onDiagnostic?.(diagnostic);
    } catch {
      // Diagnostics are observational and must not replace cache behavior.
    }
  };

  const ensureTagMetadata = async (
    tags: string[],
    fenceTimestamp: number,
    retainedUntil: number,
  ): Promise<boolean> => {
    if (tags.length === 0) return true;
    const result = await client.eval(
      ensureTagMetadataScript,
      5,
      redisTagKey(keySpace, "expired"),
      redisTagKey(keySpace, "stale"),
      redisTagKey(keySpace, "updated"),
      redisTagKey(keySpace, "retained"),
      redisMetadataFloorKey(keySpace),
      fenceTimestamp,
      retainedUntil,
      tags.length,
      ...tags,
    );
    if (result === 1) return true;
    emitDiagnostic({
      event: "safety-miss",
      operation: "read",
      reason: result === -2 ? "tag-metadata-incompatible" : "tag-metadata-absent",
    });
    return false;
  };

  const observeProspectiveSoftTags = async (
    cacheKey: string,
    softTags: string[],
    now: number,
  ): Promise<void> => {
    const tags = uniq(softTags);
    if (!(await ensureTagMetadata(tags, now, now + PENDING_TAG_RETENTION_MILLISECONDS))) return;
    if (tags.length === 0) return;
    await client
      .multi()
      .sadd(redisPendingTagsKey(keySpace, cacheKey), ...tags)
      .pexpire(redisPendingTagsKey(keySpace, cacheKey), PENDING_TAG_RETENTION_MILLISECONDS)
      .exec();
  };

  const rejectEntry = (
    reason: "buffer-limit" | "entry-size-limit",
    observedBytes: number,
    limitBytes: number,
  ): Error => {
    emitDiagnostic({ event: "entry-rejected", limitBytes, observedBytes, reason });
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
      const now = nowInEpochMilliseconds();
      if (stored !== null) {
        const restored = decodeCacheEntry(stored);
        if (!restored) {
          await observeProspectiveSoftTags(cacheKey, softTags, now);
          return entry;
        }
        if (getCacheEntryFreshness(restored, now) === "expired") {
          await observeProspectiveSoftTags(cacheKey, softTags, now);
          return entry;
        }
        const tags = uniq([...restored.tags, ...softTags]);
        const tagMetadata = await getTagMetadata(client, keySpace, tags);
        const explicitTags = new Set(restored.tags);
        const repairableSoftTags = tags.filter(
          (tag, index) =>
            tagMetadata.issues[index] === "tag-metadata-absent" &&
            !explicitTags.has(tag) &&
            tagMetadata.metadataFloor < restored.timestamp,
        );
        const softTagsEnsured = await ensureTagMetadata(
          repairableSoftTags,
          restored.timestamp,
          restored.timestamp + secondsToMilliseconds(restored.expire),
        );
        const validatedTagTimestamps = tagMetadata.timestamps.map((tagTimestamps, index) => {
          if (tagTimestamps !== null) return tagTimestamps;
          const tag = tags[index];
          if (
            softTagsEnsured &&
            tagMetadata.issues[index] === "tag-metadata-absent" &&
            typeof tag === "string" &&
            !explicitTags.has(tag) &&
            tagMetadata.metadataFloor < restored.timestamp
          ) {
            return { expiredAt: 0, staleAt: 0 };
          }
          return null;
        });
        const tagFreshness = getCacheTagFreshness(restored.timestamp, now, validatedTagTimestamps);

        if (tagFreshness === "safety-miss") {
          const safetyIssue = validatedTagTimestamps.flatMap((tagTimestamps, index) =>
            tagTimestamps === null ? [tagMetadata.issues[index]] : [],
          );
          emitDiagnostic({
            event: "safety-miss",
            operation: "read",
            reason: safetyIssue.includes("tag-metadata-incompatible")
              ? "tag-metadata-incompatible"
              : "tag-metadata-absent",
          });
          return entry;
        }

        if (tagFreshness !== "expired") {
          const revalidate = tagFreshness === "stale" ? -1 : restored.revalidate;
          entry = { ...restored, revalidate };
        }
      }
      if (!entry) await observeProspectiveSoftTags(cacheKey, softTags, now);
      return entry;
    },
    async getExpiration(tags): Promise<number> {
      const tagMetadata = await getTagMetadata(client, keySpace, tags);
      if (tagMetadata.issue !== null) {
        if (tagMetadata.issue === "tag-metadata-incompatible" || tagMetadata.metadataFloor > 0) {
          emitDiagnostic({
            event: "safety-miss",
            operation: "read",
            reason: tagMetadata.issue,
          });
          return Number.POSITIVE_INFINITY;
        }
      }
      return Math.max(
        0,
        ...tagMetadata.timestamps
          .map((timestamps) => timestamps?.expiredAt)
          .filter((timestamp): timestamp is number => typeof timestamp === "number"),
      );
    },
    getResourceState(): RedisCacheResourceState {
      return { bufferedBytes, pendingWrites: pendingSets.size };
    },
    async refreshTags(): Promise<void> {
      await client.eval(
        cleanupTagMetadataScript,
        5,
        redisTagKey(keySpace, "stale"),
        redisTagKey(keySpace, "expired"),
        redisTagKey(keySpace, "updated"),
        redisTagKey(keySpace, "retained"),
        redisMetadataFloorKey(keySpace),
        nowInEpochMilliseconds(),
      );
    },
    async set(cacheKey, pendingEntry): Promise<void> {
      const write = (async (): Promise<void> => {
        const entry = await pendingEntry;
        const serialized = await serializeEntry(entry);
        try {
          const publication = await client.eval(
            publishEntryScript,
            7,
            redisKey(keySpace, cacheKey),
            redisTagKey(keySpace, "stale"),
            redisTagKey(keySpace, "expired"),
            redisTagKey(keySpace, "updated"),
            redisTagKey(keySpace, "retained"),
            redisMetadataFloorKey(keySpace),
            redisPendingTagsKey(keySpace, cacheKey),
            serialized.stored,
            entry.timestamp,
            nowInEpochMilliseconds(),
            Math.max(1, Math.ceil(entry.expire)),
            entry.tags.length,
            ...entry.tags,
          );
          if (publication === -2 || publication === -3) {
            emitDiagnostic({
              event: "safety-miss",
              operation: "write",
              reason: publication === -3 ? "tag-metadata-absent" : "tag-metadata-incompatible",
            });
          }
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
        5,
        redisTagKey(keySpace, "stale"),
        redisTagKey(keySpace, "expired"),
        redisTagKey(keySpace, "updated"),
        redisTagKey(keySpace, "retained"),
        redisMetadataFloorKey(keySpace),
        now,
        expiresAt,
        durations ? 1 : 0,
        uniqueTags.length,
        ...uniqueTags,
      );
    },
  };
}
