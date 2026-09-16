import { secondsToMilliseconds } from "date-fns/secondsToMilliseconds";

import type { CacheEntryMetadata } from "./cache-entry-codec.ts";

export type CacheEntryFreshness = "expired" | "fresh" | "stale";

export type CacheTagTimestamps = Readonly<{
  expiredAt: number | null;
  staleAt: number | null;
}>;

export function getCacheEntryFreshness(
  entry: Pick<CacheEntryMetadata, "expire" | "revalidate" | "timestamp">,
  now: number,
): CacheEntryFreshness {
  if (now > entry.timestamp + secondsToMilliseconds(entry.expire)) return "expired";
  if (now > entry.timestamp + secondsToMilliseconds(entry.revalidate)) return "stale";
  return "fresh";
}

export function getCacheTagFreshness(
  entryTimestamp: number,
  now: number,
  tagTimestamps: CacheTagTimestamps[],
): CacheEntryFreshness {
  if (
    tagTimestamps.some(
      ({ expiredAt }) => expiredAt !== null && expiredAt <= now && expiredAt > entryTimestamp,
    )
  ) {
    return "expired";
  }
  if (tagTimestamps.some(({ staleAt }) => staleAt !== null && staleAt > entryTimestamp)) {
    return "stale";
  }
  return "fresh";
}
