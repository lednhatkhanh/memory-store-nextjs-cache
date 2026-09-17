import { describe, expect, it } from "vitest";

import {
  createCacheNamespace,
  createRedisCacheHandler,
  type CacheNamespaceInput,
} from "../src/index.js";

const baseNamespace: CacheNamespaceInput = {
  application: "reference-app",
  environment: "production",
  locale: "en",
  release: "2026-09-17.1",
  site: "reference",
};

describe("cache namespace", () => {
  it("constructs one deterministic opaque namespace from public deployment dimensions", () => {
    expect(createCacheNamespace(baseNamespace)).toEqual({
      deployment: "76bf2aeb3f9f79a7ebd9e0d21c0eae5c045c6edc222d1b2050d939ba956b7f24",
      release: "43ba897537c8bc1d3e66d00991cf45ce98d2f24183eed0581451f15032ed9562",
    });

    expect(JSON.stringify(createCacheNamespace(baseNamespace))).not.toMatch(
      /reference-app|production|reference|2026-09-17\.1/u,
    );
  }, 1_000);

  it.each([
    ["application", "another-app"],
    ["environment", "staging"],
    ["site", "another-site"],
    ["locale", "fr"],
  ] as const)(
    "partitions deployment state when %s changes",
    (dimension, value) => {
      const changed = createCacheNamespace({
        ...baseNamespace,
        [dimension]: value,
      });

      expect(changed.deployment).not.toBe(createCacheNamespace(baseNamespace).deployment);
      expect(changed.release).not.toBe(createCacheNamespace(baseNamespace).release);
    },
    1_000,
  );

  it("shares invalidation scope but isolates entries between releases", () => {
    const oldRelease = createCacheNamespace(baseNamespace);
    const newRelease = createCacheNamespace({ ...baseNamespace, release: "2026-09-17.2" });

    expect(newRelease.deployment).toBe(oldRelease.deployment);
    expect(newRelease.release).not.toBe(oldRelease.release);
  }, 1_000);

  it("rejects a digest-shaped object that was not constructed by the namespace model", () => {
    const forged = {
      deployment: "a".repeat(64),
      release: "b".repeat(64),
    };

    expect(() => Reflect.apply(createRedisCacheHandler, null, [{}, { namespace: forged }])).toThrow(
      "Redis cache namespace must be created with createCacheNamespace",
    );
  }, 1_000);

  it.each([
    ["application", ""],
    ["application", "tenant/secret"],
    ["environment", "Production"],
    ["environment", "production:password"],
    ["site", "../private"],
    ["locale", "english"],
    ["locale", "en-us"],
    ["release", "release/current"],
  ] as const)(
    "rejects an invalid %s",
    (dimension, value) => {
      expect(() => createCacheNamespace({ ...baseNamespace, [dimension]: value })).toThrow(
        `Invalid cache namespace ${dimension}`,
      );
    },
    1_000,
  );
});
