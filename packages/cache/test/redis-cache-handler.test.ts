import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { Redis } from "ioredis";
import type { StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createRedisCacheHandler,
  type CacheEntry,
  type RedisCacheDiagnostic,
  getCacheEntryFreshness,
} from "../src/index.js";

const REDIS_PORT = 6379;

function streamFromText(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

function cacheEntry({
  revision,
  tags,
  timestamp,
}: {
  revision: string;
  tags: string[];
  timestamp: number;
}): CacheEntry {
  return {
    expire: 3_600,
    revalidate: 300,
    stale: 60,
    tags,
    timestamp,
    value: streamFromText(revision),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
} {
  return Promise.withResolvers<T>();
}

function controlledStream(firstChunk: string): {
  cancelled: Promise<unknown>;
  close: (lastChunk?: string) => void;
  error: (reason: unknown) => void;
  firstChunkConsumed: Promise<true>;
  stream: ReadableStream<Uint8Array>;
} {
  const encoder = new TextEncoder();
  const cancelled = deferred<unknown>();
  const firstChunkConsumed = deferred<true>();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let pullCount = 0;
  return {
    cancelled: cancelled.promise,
    close(lastChunk) {
      if (lastChunk) controller?.enqueue(encoder.encode(lastChunk));
      controller?.close();
    },
    error(reason) {
      controller?.error(reason);
    },
    firstChunkConsumed: firstChunkConsumed.promise,
    stream: new ReadableStream(
      {
        cancel(reason) {
          cancelled.resolve(reason);
        },
        pull(nextController) {
          controller = nextController;
          pullCount += 1;
          if (pullCount === 1) {
            controller.enqueue(encoder.encode(firstChunk));
          } else {
            firstChunkConsumed.resolve(true);
          }
        },
      },
      { highWaterMark: 0 },
    ),
  };
}

function seededRandom(seed: number): () => number {
  const modulus = 4_294_967_296;
  let state = seed;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223 + modulus) % modulus;
    return state / modulus;
  };
}

async function pollUntil<T>(
  read: () => Promise<T>,
  matches: (value: T) => boolean,
  timeoutMilliseconds: number,
): Promise<T> {
  const deadline = performance.now() + timeoutMilliseconds;
  const poll = async (): Promise<T> => {
    const value = await read();
    if (matches(value)) return value;
    if (performance.now() > deadline) {
      throw new Error(`Condition was not met within ${timeoutMilliseconds}ms`);
    }
    await delay(10);
    return poll();
  };
  return poll();
}

describe("Redis Cache Components handler", () => {
  let container: StartedTestContainer;
  let redis: Redis;

  beforeAll(async () => {
    if (!process.env["DOCKER_HOST"]) {
      const activeDockerHost = execFileSync(
        "docker",
        ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"],
        { encoding: "utf8" },
      ).trim();
      const dockerHost: unknown = JSON.parse(activeDockerHost);
      if (typeof dockerHost !== "string") {
        throw new Error("Active Docker context did not provide a host");
      }
      process.env["DOCKER_HOST"] = dockerHost;
    }

    const { GenericContainer, Wait } = await import("testcontainers");
    container = await new GenericContainer("redis:8.2.1-alpine")
      .withExposedPorts(REDIS_PORT)
      .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
      .start();
    redis = new Redis({
      host: container.getHost(),
      port: container.getMappedPort(REDIS_PORT),
    });
  }, 60_000);

  afterAll(async () => {
    const cleanup = await Promise.allSettled([redis?.quit(), container?.stop()]);
    const errors = cleanup.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) throw new AggregateError(errors, "Redis test cleanup failed");
  });

  it("stores and retrieves a Cache Components entry through ioredis", async () => {
    const handler = createRedisCacheHandler(redis, {
      namespace: `cache-handler-test:${randomUUID()}`,
    });
    const original = cacheEntry({
      revision: "cached-render",
      tags: ["article:welcome"],
      timestamp: Date.now(),
    });

    await handler.set("cache-key", Promise.resolve(original));
    const restored = await handler.get("cache-key", []);

    expect(restored).toMatchObject({
      expire: 3_600,
      revalidate: 300,
      stale: 60,
      tags: ["article:welcome"],
      timestamp: original.timestamp,
    });
    await expect(new Response(restored?.value).text()).resolves.toBe("cached-render");
  }, 60_000);

  it("serves a time-stale entry only until its hard-expiration boundary", async () => {
    const handler = createRedisCacheHandler(redis, {
      namespace: `cache-handler-test:${randomUUID()}`,
    });
    const original = {
      ...cacheEntry({
        revision: "stale-render",
        tags: ["article:welcome"],
        timestamp: performance.timeOrigin + performance.now(),
      }),
      expire: 0.2,
      revalidate: 0.05,
    };

    await handler.set("cache-key", Promise.resolve(original));
    const stale = await pollUntil(
      async () => handler.get("cache-key", []),
      (entry) =>
        entry
          ? getCacheEntryFreshness(entry, performance.timeOrigin + performance.now()) === "stale"
          : false,
      500,
    );
    await expect(new Response(stale?.value).text()).resolves.toBe("stale-render");

    await expect(
      pollUntil(
        async () => handler.get("cache-key", []),
        (entry) => !entry,
        500,
      ),
    ).resolves.toBeUndefined();
  }, 60_000);

  it.each([
    ["throws", new Error("render failed")],
    ["is cancelled", new DOMException("render cancelled", "AbortError")],
  ])(
    "keeps the previous complete entry when a replacement stream %s",
    async (_state, reason) => {
      const handler = createRedisCacheHandler(redis, {
        namespace: `cache-handler-test:${randomUUID()}`,
      });
      const timestamp = Date.now();
      await handler.set(
        "cache-key",
        Promise.resolve(
          cacheEntry({
            revision: "previous-complete-render",
            tags: ["article:welcome"],
            timestamp,
          }),
        ),
      );
      const replacement = controlledStream("partial-");
      const write = handler.set(
        "cache-key",
        Promise.resolve({
          ...cacheEntry({
            revision: "unused",
            tags: ["article:welcome"],
            timestamp: timestamp + 1,
          }),
          value: replacement.stream,
        }),
      );
      const read = handler.get("cache-key", []);

      await replacement.firstChunkConsumed;
      replacement.error(reason);

      await expect(write).rejects.toThrow(reason.message);
      const restored = await read;
      await expect(new Response(restored?.value).text()).resolves.toBe("previous-complete-render");
    },
    60_000,
  );

  it("publishes a streamed replacement only after the complete value is available", async () => {
    const namespace = `cache-handler-test:${randomUUID()}`;
    const writer = createRedisCacheHandler(redis, { namespace });
    const observerRedis = redis.duplicate();
    const observer = createRedisCacheHandler(observerRedis, { namespace });
    const timestamp = Date.now();
    const replacement = controlledStream("new-");

    try {
      await writer.set(
        "cache-key",
        Promise.resolve(
          cacheEntry({
            revision: "previous-complete-render",
            tags: ["article:welcome"],
            timestamp,
          }),
        ),
      );
      const write = writer.set(
        "cache-key",
        Promise.resolve({
          ...cacheEntry({
            revision: "unused",
            tags: ["article:welcome"],
            timestamp: timestamp + 1,
          }),
          value: replacement.stream,
        }),
      );
      await replacement.firstChunkConsumed;

      const whilePending = await observer.get("cache-key", []);
      await expect(new Response(whilePending?.value).text()).resolves.toBe(
        "previous-complete-render",
      );

      replacement.close("complete-render");
      await write;
      const afterPublication = await observer.get("cache-key", []);
      await expect(new Response(afterPublication?.value).text()).resolves.toBe(
        "new-complete-render",
      );
    } finally {
      await observerRedis.quit();
    }
  }, 60_000);

  it("rejects an oversized streamed entry without replacing the complete value", async () => {
    const namespace = `cache-handler-test:${randomUUID()}`;
    const seedingHandler = createRedisCacheHandler(redis, { namespace });
    const diagnostics: RedisCacheDiagnostic[] = [];
    const boundedHandler = createRedisCacheHandler(redis, {
      maxBufferedBytes: 16,
      maxEntrySizeBytes: 89,
      namespace,
      onDiagnostic(diagnostic) {
        diagnostics.push(diagnostic);
      },
    });
    const timestamp = Date.now();
    await seedingHandler.set(
      "cache-key",
      Promise.resolve(
        cacheEntry({
          revision: "previous-complete-render",
          tags: ["article:welcome"],
          timestamp,
        }),
      ),
    );

    const oversized = controlledStream("123456");
    const rejectedWrite = boundedHandler.set(
      "cache-key",
      Promise.resolve({
        ...cacheEntry({
          revision: "unused",
          tags: ["article:welcome"],
          timestamp: 2,
        }),
        value: oversized.stream,
      }),
    );
    await expect(rejectedWrite).rejects.toThrow("Redis cache entry rejected: entry-size-limit");

    expect(diagnostics).toEqual([
      {
        event: "entry-rejected",
        limitBytes: 89,
        observedBytes: 90,
        reason: "entry-size-limit",
      },
    ]);
    await expect(oversized.cancelled).resolves.toMatchObject({
      message: "Redis cache entry rejected: entry-size-limit",
    });
    expect(JSON.stringify(diagnostics[0]).length).toBeLessThan(128);
    const restored = await boundedHandler.get("cache-key", []);
    await expect(new Response(restored?.value).text()).resolves.toBe("previous-complete-render");
  }, 60_000);

  it("bounds bytes buffered across concurrent streamed entries", async () => {
    const diagnostics: RedisCacheDiagnostic[] = [];
    const handler = createRedisCacheHandler(redis, {
      maxBufferedBytes: 6,
      maxEntrySizeBytes: 1_000,
      namespace: `cache-handler-test:${randomUUID()}`,
      onDiagnostic(diagnostic) {
        diagnostics.push(diagnostic);
      },
    });
    const first = controlledStream("1234");
    const timestamp = Date.now();
    const firstWrite = handler.set(
      "first-cache-key",
      Promise.resolve({
        ...cacheEntry({ revision: "unused", tags: [], timestamp }),
        value: first.stream,
      }),
    );
    await first.firstChunkConsumed;

    await expect(
      handler.set(
        "second-cache-key",
        Promise.resolve(cacheEntry({ revision: "5678", tags: [], timestamp: timestamp + 1 })),
      ),
    ).rejects.toThrow("Redis cache entry rejected: buffer-limit");

    expect(diagnostics).toContainEqual({
      event: "entry-rejected",
      limitBytes: 6,
      observedBytes: 8,
      reason: "buffer-limit",
    });
    first.close();
    await firstWrite;
  }, 60_000);

  it("releases buffered-byte reservations and pending writes after rejection and completion", async () => {
    const handler = createRedisCacheHandler(redis, {
      maxBufferedBytes: 6,
      maxEntrySizeBytes: 1_000,
      namespace: `cache-handler-test:${randomUUID()}`,
    });
    const rejected = controlledStream("1234567");

    await expect(
      handler.set(
        "rejected-cache-key",
        Promise.resolve({
          ...cacheEntry({ revision: "unused", tags: [], timestamp: Date.now() }),
          value: rejected.stream,
        }),
      ),
    ).rejects.toThrow("Redis cache entry rejected: buffer-limit");
    expect(handler.getResourceState()).toEqual({ bufferedBytes: 0, pendingWrites: 0 });

    const accepted = controlledStream("123456");
    const write = handler.set(
      "accepted-cache-key",
      Promise.resolve({
        ...cacheEntry({ revision: "unused", tags: [], timestamp: Date.now() + 1 }),
        value: accepted.stream,
      }),
    );
    await accepted.firstChunkConsumed;
    expect(handler.getResourceState()).toEqual({ bufferedBytes: 6, pendingWrites: 1 });

    accepted.close();
    await write;
    expect(handler.getResourceState()).toEqual({ bufferedBytes: 0, pendingWrites: 0 });
  }, 60_000);

  it("invalidates matching tagged entries across handler instances", async () => {
    const namespace = `cache-handler-test:${randomUUID()}`;
    const invalidatingHandler = createRedisCacheHandler(redis, { namespace });
    const servingRedis = redis.duplicate();
    const servingHandler = createRedisCacheHandler(servingRedis, { namespace });
    const timestamp = Date.now() - 1_000;

    try {
      await Promise.all([
        servingHandler.set(
          "welcome-cache-key",
          Promise.resolve(
            cacheEntry({
              revision: "welcome-revision-1",
              tags: ["document:reference:en:welcome"],
              timestamp,
            }),
          ),
        ),
        servingHandler.set(
          "alpha-cache-key",
          Promise.resolve(
            cacheEntry({
              revision: "alpha-revision-1",
              tags: ["document:reference:en:alpha"],
              timestamp,
            }),
          ),
        ),
      ]);

      await invalidatingHandler.updateTags(["document:reference:en:welcome"], { expire: 0 });

      await expect(servingHandler.get("welcome-cache-key", [])).resolves.toBeUndefined();
      const unrelated = await servingHandler.get("alpha-cache-key", []);
      await expect(new Response(unrelated?.value).text()).resolves.toBe("alpha-revision-1");
    } finally {
      await servingRedis.quit();
    }
  }, 60_000);

  it("accepts a fresh completion before a deferred expiration deadline", async () => {
    const namespace = `cache-handler-test:${randomUUID()}`;
    const handler = createRedisCacheHandler(redis, { namespace });
    const tag = "document:reference:en:welcome";

    await handler.updateTags([tag], { expire: 60 });
    await handler.set(
      "welcome-cache-key",
      Promise.resolve(
        cacheEntry({
          revision: "welcome-revision-2",
          tags: [tag],
          timestamp: performance.timeOrigin + performance.now(),
        }),
      ),
    );

    const restored = await handler.get("welcome-cache-key", []);
    await expect(new Response(restored?.value).text()).resolves.toBe("welcome-revision-2");
  }, 60_000);

  it("returns a future delayed expiration through the handler contract", async () => {
    const handler = createRedisCacheHandler(redis, {
      namespace: `cache-handler-test:${randomUUID()}`,
    });
    const beforeUpdate = performance.timeOrigin + performance.now();

    await handler.updateTags(["document:reference:en:welcome"], { expire: 60 });

    await expect(handler.getExpiration(["document:reference:en:welcome"])).resolves.toBeGreaterThan(
      beforeUpdate + 59_000,
    );
  }, 60_000);

  it("lets a newer expire-now update replace an older deferred expiration", async () => {
    const namespace = `cache-handler-test:${randomUUID()}`;
    const invalidatingHandler = createRedisCacheHandler(redis, { namespace });
    const servingRedis = redis.duplicate();
    const servingHandler = createRedisCacheHandler(servingRedis, { namespace });
    const tag = "document:reference:en:welcome";

    try {
      await invalidatingHandler.updateTags([tag], { expire: 60 });
      const timestamp = performance.timeOrigin + performance.now();
      await servingHandler.set(
        "welcome-cache-key",
        Promise.resolve(
          cacheEntry({
            revision: "welcome-revision-2",
            tags: [tag],
            timestamp,
          }),
        ),
      );
      const beforeExpireNow = await servingHandler.get("welcome-cache-key", []);
      await expect(new Response(beforeExpireNow?.value).text()).resolves.toBe("welcome-revision-2");

      await invalidatingHandler.updateTags([tag], { expire: 0 });

      await expect(servingHandler.get("welcome-cache-key", [])).resolves.toBeUndefined();
    } finally {
      await servingRedis.quit();
    }
  }, 60_000);

  it("serves a tag-stale entry only within a delayed expiration policy", async () => {
    const namespace = `cache-handler-test:${randomUUID()}`;
    const invalidatingHandler = createRedisCacheHandler(redis, { namespace });
    const servingRedis = redis.duplicate();
    const servingHandler = createRedisCacheHandler(servingRedis, { namespace });
    const tag = "document:reference:en:welcome";
    const timestamp = performance.timeOrigin + performance.now();

    try {
      await servingHandler.set(
        "welcome-cache-key",
        Promise.resolve(
          cacheEntry({
            revision: "welcome-revision-1",
            tags: [tag],
            timestamp,
          }),
        ),
      );
      await invalidatingHandler.updateTags([tag], { expire: 0.2 });
      await invalidatingHandler.updateTags([tag], {});

      const stale = await servingHandler.get("welcome-cache-key", []);
      expect(stale?.revalidate).toBe(-1);
      await expect(new Response(stale?.value).text()).resolves.toBe("welcome-revision-1");
      await expect(
        pollUntil(
          async () => servingHandler.get("welcome-cache-key", []),
          (entry) => !entry,
          500,
        ),
      ).resolves.toBeUndefined();
    } finally {
      await servingRedis.quit();
    }
  }, 60_000);

  it("rejects a completion whose render started before invalidation", async () => {
    const namespace = `cache-handler-test:${randomUUID()}`;
    const invalidatingHandler = createRedisCacheHandler(redis, { namespace });
    const oldWriterRedis = redis.duplicate();
    const newWriterRedis = redis.duplicate();
    const oldWriter = createRedisCacheHandler(oldWriterRedis, { namespace });
    const newWriter = createRedisCacheHandler(newWriterRedis, { namespace });
    const tag = "document:reference:en:welcome";
    const oldEntry = deferred<CacheEntry>();

    try {
      const oldWrite = oldWriter.set("welcome-cache-key", oldEntry.promise);
      await invalidatingHandler.updateTags([tag], { expire: 0 });
      const invalidatedAt = await invalidatingHandler.getExpiration([tag]);

      await newWriter.set(
        "welcome-cache-key",
        Promise.resolve(
          cacheEntry({
            revision: "welcome-revision-2",
            tags: [tag],
            timestamp: invalidatedAt + 1,
          }),
        ),
      );
      oldEntry.resolve(
        cacheEntry({
          revision: "welcome-revision-1",
          tags: [tag],
          timestamp: invalidatedAt - 1,
        }),
      );
      await oldWrite;

      const restored = await invalidatingHandler.get("welcome-cache-key", []);
      await expect(new Response(restored?.value).text()).resolves.toBe("welcome-revision-2");
    } finally {
      await Promise.all([oldWriterRedis.quit(), newWriterRedis.quit()]);
    }
  }, 60_000);

  it("does not let an older overlapping completion replace a newer entry", async () => {
    const namespace = `cache-handler-test:${randomUUID()}`;
    const oldWriterRedis = redis.duplicate();
    const newWriterRedis = redis.duplicate();
    const oldWriter = createRedisCacheHandler(oldWriterRedis, { namespace });
    const newWriter = createRedisCacheHandler(newWriterRedis, { namespace });
    const oldEntry = deferred<CacheEntry>();
    const startedAt = performance.timeOrigin + performance.now();
    const trace = [
      `1. started welcome-revision-1 at ${startedAt}`,
      `2. started and completed welcome-revision-2 at ${startedAt + 1}`,
      `3. completed welcome-revision-1 at ${startedAt}`,
    ];

    try {
      const oldWrite = oldWriter.set("welcome-cache-key", oldEntry.promise);
      await newWriter.set(
        "welcome-cache-key",
        Promise.resolve(
          cacheEntry({
            revision: "welcome-revision-2",
            tags: ["document:reference:en:welcome"],
            timestamp: startedAt + 1,
          }),
        ),
      );
      oldEntry.resolve(
        cacheEntry({
          revision: "welcome-revision-1",
          tags: ["document:reference:en:welcome"],
          timestamp: startedAt,
        }),
      );
      await oldWrite;

      const restored = await newWriter.get("welcome-cache-key", []);
      try {
        await expect(new Response(restored?.value).text()).resolves.toBe("welcome-revision-2");
      } catch (error) {
        throw new Error(`Overlapping publication order:\n${trace.join("\n")}`, { cause: error });
      }
    } finally {
      await Promise.all([oldWriterRedis.quit(), newWriterRedis.quit()]);
    }
  }, 60_000);

  it("preserves the newest valid revision across seeded operation orderings", async () => {
    const seed = 0x5a17e;
    const random = seededRandom(seed);
    const namespace = `cache-handler-test:${randomUUID()}`;
    const writerRedis = redis.duplicate();
    const readerRedis = redis.duplicate();
    const writer = createRedisCacheHandler(writerRedis, { namespace });
    const reader = createRedisCacheHandler(readerRedis, { namespace });
    const tag = "document:reference:en:welcome";
    const cacheKey = "welcome-cache-key";
    const trace: string[] = [];
    let invalidatedAt = 0;
    let nextRevision = 1;
    let expected: { revision: string; timestamp: number } | null = null;
    const pending: Array<{
      entry: ReturnType<typeof deferred<CacheEntry>>;
      revision: string;
      timestamp: number;
      write: Promise<void>;
    }> = [];

    const startWrite = (): void => {
      const revision = `revision-${nextRevision}`;
      nextRevision += 1;
      const timestamp = performance.timeOrigin + performance.now();
      const entry = deferred<CacheEntry>();
      const write = writer.set(cacheKey, entry.promise);
      pending.push({ entry, revision, timestamp, write });
      trace.push(`start ${revision} at ${timestamp}`);
    };

    const completeWrite = async (index: number): Promise<void> => {
      const [candidate] = pending.splice(index, 1);
      if (!candidate) throw new Error(`No pending write at index ${index}`);
      candidate.entry.resolve(
        cacheEntry({
          revision: candidate.revision,
          tags: [tag],
          timestamp: candidate.timestamp,
        }),
      );
      await candidate.write;
      const accepted =
        candidate.timestamp > invalidatedAt &&
        (expected === null || candidate.timestamp > expected.timestamp);
      if (accepted) {
        expected = { revision: candidate.revision, timestamp: candidate.timestamp };
      }
      trace.push(`complete ${candidate.revision}; expected=${expected?.revision ?? "miss"}`);
    };

    const invalidate = async (): Promise<void> => {
      await reader.updateTags([tag], { expire: 0 });
      invalidatedAt = await reader.getExpiration([tag]);
      if (expected && invalidatedAt >= expected.timestamp) expected = null;
      trace.push(`invalidate at ${invalidatedAt}`);
    };

    const read = async (): Promise<void> => {
      const restored = await reader.get(cacheKey, []);
      const actual = restored ? await new Response(restored.value).text() : null;
      trace.push(`read actual=${actual ?? "miss"}; expected=${expected?.revision ?? "miss"}`);
      expect(actual).toBe(expected?.revision ?? null);
    };

    const runGeneratedOperations = async (remaining: number): Promise<void> => {
      if (remaining === 0) return;
      const choice = Math.floor(random() * 4);
      if (choice === 0 || pending.length === 0) {
        startWrite();
      } else if (choice === 1) {
        await invalidate();
      } else if (choice === 2) {
        await read();
      } else {
        await completeWrite(Math.floor(random() * pending.length));
      }
      await runGeneratedOperations(remaining - 1);
    };

    const completePendingWrites = async (): Promise<void> => {
      if (pending.length === 0) return;
      await completeWrite(Math.floor(random() * pending.length));
      await completePendingWrites();
    };

    try {
      startWrite();
      await completeWrite(0);
      await read();
      startWrite();
      await invalidate();
      startWrite();
      await completeWrite(1);
      await completeWrite(0);
      await read();

      await runGeneratedOperations(80);
      await completePendingWrites();
      await read();
    } catch (error) {
      throw new Error(
        `Seeded cache model failed (seed=${seed}):\n${trace.map((event, index) => `${index + 1}. ${event}`).join("\n")}`,
        { cause: error },
      );
    } finally {
      await Promise.all([writerRedis.quit(), readerRedis.quit()]);
    }
  }, 60_000);
});
