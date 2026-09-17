import { describe, expect, it } from "vitest";

import {
  getCacheEntryFreshness,
  getCacheTagFreshness,
  type CacheEntryMetadata,
} from "../src/index.ts";

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

  it("treats missing tag metadata as a safety miss", () => {
    expect(getCacheTagFreshness(20 * SECOND, 30 * SECOND, [null])).toBe("safety-miss");
  }, 1_000);

  it("preserves the safety invariant across seeded lifetime and invalidation orderings", () => {
    const seed = 0x10_5afe;
    const modulus = 4_294_967_296;
    let randomState = seed;
    const random = (): number => {
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223 + modulus) % modulus;
      return randomState / modulus;
    };
    let clock = 1;
    let entryTimestamp: number | null = 1;
    let tagMetadataState: { expiredAt: number | null; staleAt: number | null } | null = {
      expiredAt: 0,
      staleAt: 0,
    };
    let metadataFloor = 0;
    let pendingTimestamp: number | null = null;
    const trace: string[] = [];

    const read = (): void => {
      if (entryTimestamp === null) return;
      const freshness = getCacheTagFreshness(entryTimestamp, clock, [tagMetadataState]);
      const expected =
        tagMetadataState === null
          ? "safety-miss"
          : tagMetadataState.expiredAt !== null &&
              tagMetadataState.expiredAt <= clock &&
              tagMetadataState.expiredAt > entryTimestamp
            ? "expired"
            : tagMetadataState.staleAt !== null && tagMetadataState.staleAt > entryTimestamp
              ? "stale"
              : "fresh";
      expect(freshness).toBe(expected);
      trace.push(`read=${freshness} at ${clock}`);
    };

    const runOperation = (choice: number): void => {
      clock += 1;
      if (choice === 0) {
        read();
      } else if (choice === 1) {
        pendingTimestamp = clock;
        trace.push(`start write at ${clock}`);
      } else if (choice === 2) {
        tagMetadataState = { expiredAt: clock, staleAt: clock };
        metadataFloor = clock;
        trace.push(`invalidate at ${clock}`);
      } else if (choice === 3) {
        tagMetadataState = null;
        trace.push(`metadata disappears at ${clock}`);
      } else if (pendingTimestamp !== null) {
        if (pendingTimestamp > metadataFloor) {
          entryTimestamp = pendingTimestamp;
          tagMetadataState ??= { expiredAt: 0, staleAt: 0 };
        }
        trace.push(`complete write from ${pendingTimestamp} at ${clock}`);
        pendingTimestamp = null;
      }
    };

    try {
      runOperation(0);
      runOperation(1);
      runOperation(2);
      runOperation(3);
      runOperation(4);
      runOperation(0);
      for (let index = 0; index < 100; index += 1) {
        runOperation(Math.floor(random() * 5));
      }
    } catch (error) {
      throw new Error(`Tag lifetime model failed (seed=${seed}):\n${trace.join("\n")}`, {
        cause: error,
      });
    }
  }, 1_000);
});
