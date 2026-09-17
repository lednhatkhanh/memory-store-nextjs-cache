import { describe, expect, it } from "vitest";

import { getReferenceApplicationConfig } from "../src/lib/application-config";

describe("reference application configuration", () => {
  it("sources and validates every public cache partition from the application environment", () => {
    const config = getReferenceApplicationConfig({
      REDIS_CACHE_ENVIRONMENT: "production",
      REDIS_CACHE_LOCALE: "fr-FR",
      REDIS_CACHE_NAMESPACE: "reference-app",
      REDIS_CACHE_RELEASE: "2026-09-17.2",
      REDIS_CACHE_SITE: "marketing",
    });

    expect(config.content).toEqual({ locale: "fr-FR", site: "marketing" });
    expect(config.namespace).toEqual({
      deployment: "c92a822b02120cd58d874fddbef9f714818eaa00a46d74386918ec7d49b77f8f",
      release: "38e0a4804bdd59dd8cee3b525d99cc1b1ec122a6709653c915afb82d2baa3fe8",
    });
  });

  it("provides validated local-development defaults", () => {
    expect(getReferenceApplicationConfig({}).content).toEqual({
      locale: "en",
      site: "reference",
    });
  });

  it.each([
    ["REDIS_CACHE_ENVIRONMENT", "Production", "Invalid cache namespace"],
    ["REDIS_CACHE_LOCALE", "en-us", "Invalid cache namespace"],
    ["REDIS_CACHE_NAMESPACE", "reference/app", "Invalid cache namespace"],
    ["REDIS_CACHE_RELEASE", "release/current", "Invalid cache namespace"],
    ["REDIS_CACHE_SITE", "../private", "Invalid cache namespace"],
    ["REDIS_CACHE_SITE", "marketing.site", "Invalid public content site"],
  ] as const)("rejects invalid %s input", (name, value, message) => {
    expect(() => getReferenceApplicationConfig({ [name]: value })).toThrow(message);
  });
});
