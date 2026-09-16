import { describe, expect, it } from "vitest";

import {
  decodeCacheEntry,
  encodeCacheEntry,
  type CacheEntryMetadata,
} from "../src/cache-entry-codec.js";

const encoder = new TextEncoder();

function metadata(overrides: Partial<CacheEntryMetadata> = {}): CacheEntryMetadata {
  return {
    expire: 3_600,
    revalidate: 300,
    stale: 60,
    tags: ["document:reference:en:welcome"],
    timestamp: 1_789_555_200_123.5,
    ...overrides,
  };
}

describe("cache entry serialization", () => {
  it("round-trips the streamed value and every Next.js cache metadata field", async () => {
    const value = encoder.encode("complete streamed render");
    const original = metadata();

    const encoded = encodeCacheEntry(original, value);
    const restored = decodeCacheEntry(encoded);

    expect(restored).toMatchObject(original);
    await expect(new Response(restored?.value).text()).resolves.toBe("complete streamed render");
  }, 1_000);

  it.each([
    ["malformed JSON", "{"],
    [
      "an incompatible format version",
      JSON.stringify({
        version: 2,
        metadata: metadata(),
        value: { byteLength: 0, sha256: "0".repeat(64) },
      }),
    ],
    [
      "invalid cache metadata",
      JSON.stringify({
        version: 1,
        metadata: metadata({ expire: Number.NaN }),
        value: { byteLength: 0, sha256: "0".repeat(64) },
      }),
    ],
  ])(
    "treats %s as a safe miss",
    (_scenario, encoded) => {
      expect(decodeCacheEntry(encoded)).toBeNull();
    },
    1_000,
  );

  it("rejects invalid metadata before serialization", () => {
    expect(() =>
      encodeCacheEntry(metadata({ timestamp: Number.POSITIVE_INFINITY }), new Uint8Array()),
    ).toThrow("Cache entry metadata has an invalid shape");
  }, 1_000);

  it("treats a truncated stored value as a safe miss", () => {
    const complete = encoder.encode("complete streamed render");
    const encoded = encodeCacheEntry(metadata(), complete);
    const stored: unknown = JSON.parse(encoded);
    if (typeof stored !== "object" || stored === null) throw new Error("Expected stored entry");
    const storedValue: unknown = Reflect.get(stored, "value");
    if (typeof storedValue !== "object" || storedValue === null) {
      throw new Error("Expected stored value");
    }
    Reflect.set(
      storedValue,
      "base64",
      Buffer.from(complete.subarray(0, complete.byteLength - 1)).toString("base64"),
    );

    expect(decodeCacheEntry(JSON.stringify(stored))).toBeNull();
  }, 1_000);
});
