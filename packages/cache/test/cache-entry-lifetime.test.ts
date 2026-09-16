import { describe, expect, it } from "vitest";

import {
  getCacheEntryFreshness,
  getCacheTagFreshness,
  type CacheEntryMetadata,
} from "../src/index.js";

const SECOND = 1_000;

function metadata(overrides: Partial<CacheEntryMetadata> = {}): CacheEntryMetadata {
  return {
    expire: 10,
    revalidate: 4,
    stale: 30,
    tags: [],
    timestamp: 20 * SECOND,
    ...overrides,
  };
}

describe("Cache Components entry freshness", () => {
  it("keeps an entry fresh through its revalidation boundary", () => {
    const entry = metadata();

    expect(getCacheEntryFreshness(entry, entry.timestamp + entry.revalidate * SECOND)).toBe(
      "fresh",
    );
  }, 1_000);

  it("makes an entry stale after revalidation and through hard expiration", () => {
    const entry = metadata();

    expect(getCacheEntryFreshness(entry, entry.timestamp + entry.revalidate * SECOND + 1)).toBe(
      "stale",
    );
    expect(getCacheEntryFreshness(entry, entry.timestamp + entry.expire * SECOND)).toBe("stale");
  }, 1_000);

  it("hard-expires an entry only after its expiration boundary", () => {
    const entry = metadata();

    expect(getCacheEntryFreshness(entry, entry.timestamp + entry.expire * SECOND + 1)).toBe(
      "expired",
    );
  }, 1_000);

  it("preserves fractional epoch precision at freshness boundaries", () => {
    const entry = metadata({ expire: 0.002, revalidate: 0.001, timestamp: 20_000.5 });

    expect(getCacheEntryFreshness(entry, 20_001.5)).toBe("fresh");
    expect(getCacheEntryFreshness(entry, 20_002.5)).toBe("stale");
    expect(getCacheEntryFreshness(entry, 20_002.501)).toBe("expired");
  }, 1_000);

  it("uses strict tag timestamps at stale and expired boundaries", () => {
    const entryTimestamp = 20 * SECOND;
    let now = 30 * SECOND;

    expect(
      getCacheTagFreshness(entryTimestamp, now, [
        { expiredAt: entryTimestamp, staleAt: entryTimestamp },
      ]),
    ).toBe("fresh");

    now += 1;
    expect(
      getCacheTagFreshness(entryTimestamp, now, [{ expiredAt: now, staleAt: entryTimestamp + 1 }]),
    ).toBe("expired");
  }, 1_000);
});
