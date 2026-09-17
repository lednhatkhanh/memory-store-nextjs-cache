import { Redis } from "ioredis";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";

import {
  createCacheNamespace,
  createRedisCacheHandler,
  type CacheNamespace,
  type CacheEntry,
  type RedisCacheDiagnostic,
} from "../src/index.ts";

function namespace(): CacheNamespace {
  return createCacheNamespace({
    application: "failure-policy",
    environment: "test",
    locale: "en",
    release: "test-release",
    site: "reference",
  });
}

function entry(onCancel?: () => void): CacheEntry {
  return {
    expire: 60,
    revalidate: 30,
    stale: 10,
    tags: ["document:reference:en:welcome"],
    timestamp: Date.now(),
    value: new ReadableStream({
      ...(onCancel ? { cancel: onCancel } : {}),
      start(controller): void {
        controller.enqueue(new TextEncoder().encode("fresh source render"));
        controller.close();
      },
    }),
  };
}

describe("Redis failure policy", () => {
  it("falls back to a source render after a cache read failure and recovers later", async () => {
    const diagnostics: RedisCacheDiagnostic[] = [];
    const client = new Redis({ enableOfflineQueue: false, lazyConnect: true });
    const evalCommand = vi
      .spyOn(client, "eval")
      .mockRejectedValueOnce(new Error("Redis unavailable"))
      .mockResolvedValue("metadata-generation");
    vi.spyOn(client, "mget").mockResolvedValue([null, null]);
    const handler = createRedisCacheHandler(client, {
      namespace: namespace(),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    await expect(handler.get("cache-key", [])).resolves.toBeUndefined();
    await expect(handler.get("cache-key", [])).resolves.toBeUndefined();

    expect(evalCommand).toHaveBeenCalledTimes(2);
    expect(diagnostics).toEqual([
      {
        durationMilliseconds: expect.any(Number),
        event: "cache-read",
        result: "source-fallback",
      },
      {
        durationMilliseconds: expect.any(Number),
        event: "cache-read",
        result: "miss",
      },
    ]);
  }, 10_000);

  it("does not fail a fresh render when Redis cannot publish it", async () => {
    const diagnostics: RedisCacheDiagnostic[] = [];
    const onCancel = vi.fn<() => void>();
    const client = new Redis({ enableOfflineQueue: false, lazyConnect: true });
    vi.spyOn(client, "eval").mockRejectedValue(new Error("Redis unavailable"));
    vi.spyOn(client, "smembers").mockRejectedValue(new Error("Redis unavailable"));
    const handler = createRedisCacheHandler(client, {
      namespace: namespace(),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    await expect(
      handler.set("cache-key", Promise.resolve(entry(onCancel))),
    ).resolves.toBeUndefined();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(handler.getResourceState()).toEqual({ bufferedBytes: 0, pendingWrites: 0 });
    expect(diagnostics).toContainEqual({ event: "cache-write-failure" });
  }, 10_000);

  it("does not hold sibling renders behind an unresolved cache branch after Redis fails", async () => {
    const client = new Redis({ enableOfflineQueue: false, lazyConnect: true });
    vi.spyOn(client, "eval").mockRejectedValue(new Error("Redis unavailable"));
    vi.spyOn(client, "smembers").mockRejectedValue(new Error("Redis unavailable"));
    const handler = createRedisCacheHandler(client, { namespace: namespace() });
    const pendingEntry = Promise.withResolvers<CacheEntry>();

    const completed = await Promise.race([
      handler.set("cache-key", pendingEntry.promise).then(() => true),
      delay(50, false),
    ]);

    expect(completed).toBe(true);
    expect(handler.getResourceState()).toEqual({ bufferedBytes: 0, pendingWrites: 0 });

    pendingEntry.resolve(entry());
  }, 10_000);

  it("surfaces invalidation failure to the caller as a retryable operation", async () => {
    const diagnostics: RedisCacheDiagnostic[] = [];
    const redisFailure = new Error("Redis unavailable");
    const client = new Redis({ enableOfflineQueue: false, lazyConnect: true });
    vi.spyOn(client, "eval").mockRejectedValue(redisFailure);
    const handler = createRedisCacheHandler(client, {
      namespace: namespace(),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    await expect(handler.updateTags(["document:reference:en:welcome"], { expire: 0 })).rejects.toBe(
      redisFailure,
    );
    expect(diagnostics).toEqual([{ event: "invalidation-failure" }]);
  }, 10_000);
});
