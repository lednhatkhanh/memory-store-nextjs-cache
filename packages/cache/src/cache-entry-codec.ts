import { createHash } from "node:crypto";

export type CacheEntryMetadata = {
  expire: number;
  revalidate: number;
  stale: number;
  tags: string[];
  timestamp: number;
};

export type CacheEntry = CacheEntryMetadata & {
  value: ReadableStream<Uint8Array>;
};

type StoredCacheEntry = {
  metadata: CacheEntryMetadata;
  value: {
    base64: string;
    byteLength: number;
    sha256: string;
  };
  version: 1;
};

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isFiniteNonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCacheEntryMetadata(value: unknown): value is CacheEntryMetadata {
  if (typeof value !== "object" || value === null) return false;
  const tags: unknown = Reflect.get(value, "tags");
  return (
    isFiniteNonnegativeNumber(Reflect.get(value, "expire")) &&
    isFiniteNonnegativeNumber(Reflect.get(value, "revalidate")) &&
    isFiniteNonnegativeNumber(Reflect.get(value, "stale")) &&
    Array.isArray(tags) &&
    tags.every((tag) => typeof tag === "string") &&
    isFiniteNonnegativeNumber(Reflect.get(value, "timestamp"))
  );
}

function isStoredCacheEntry(value: unknown): value is StoredCacheEntry {
  if (typeof value !== "object" || value === null || Reflect.get(value, "version") !== 1) {
    return false;
  }
  const storedValue: unknown = Reflect.get(value, "value");
  const sha256Digest =
    typeof storedValue === "object" && storedValue !== null
      ? Reflect.get(storedValue, "sha256")
      : null;
  return (
    isCacheEntryMetadata(Reflect.get(value, "metadata")) &&
    typeof storedValue === "object" &&
    storedValue !== null &&
    Number.isSafeInteger(Reflect.get(storedValue, "byteLength")) &&
    isFiniteNonnegativeNumber(Reflect.get(storedValue, "byteLength")) &&
    typeof Reflect.get(storedValue, "base64") === "string" &&
    typeof sha256Digest === "string" &&
    /^[a-f\d]{64}$/u.test(sha256Digest)
  );
}

function streamFromBytes(value: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(value);
      controller.close();
    },
  });
}

export function encodeCacheEntry(metadata: CacheEntryMetadata, value: Uint8Array): string {
  if (!isCacheEntryMetadata(metadata)) {
    throw new Error("Cache entry metadata has an invalid shape");
  }
  const stored: StoredCacheEntry = {
    metadata,
    value: {
      base64: Buffer.from(value).toString("base64"),
      byteLength: value.byteLength,
      sha256: sha256(value),
    },
    version: 1,
  };
  return JSON.stringify(stored);
}

export function decodeCacheEntry(encoded: string): CacheEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    return null;
  }
  if (!isStoredCacheEntry(parsed)) return null;
  const value = Buffer.from(parsed.value.base64, "base64");
  if (value.toString("base64") !== parsed.value.base64) return null;
  if (parsed.value.byteLength !== value.byteLength || parsed.value.sha256 !== sha256(value)) {
    return null;
  }
  return { ...parsed.metadata, value: streamFromBytes(value) };
}
