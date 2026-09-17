import { createCacheNamespace, type CacheNamespace } from "unicorn-nextjs-memory-cache";

import { type PublicContentDimensions, validatePublicContentPartition } from "./content-client";

type Environment = Readonly<Record<string, string | undefined>>;

export type ReferenceApplicationConfig = Readonly<{
  content: Pick<PublicContentDimensions, "locale" | "site">;
  contentServiceTimeoutMilliseconds: number;
  namespace: CacheNamespace;
}>;

function positiveInteger(environment: Environment, name: string, fallback: number): number {
  const value = environment[name] === undefined ? fallback : Number(environment[name]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

export function getReferenceApplicationConfig(
  environment: Environment,
): ReferenceApplicationConfig {
  const locale = environment["REDIS_CACHE_LOCALE"] ?? "en";
  const site = environment["REDIS_CACHE_SITE"] ?? "reference";
  const namespace = createCacheNamespace({
    application: environment["REDIS_CACHE_NAMESPACE"] ?? "memory-store-nextjs-cache",
    environment: environment["REDIS_CACHE_ENVIRONMENT"] ?? "development",
    locale,
    release: environment["REDIS_CACHE_RELEASE"] ?? "local",
    site,
  });

  return {
    content: validatePublicContentPartition({ locale, site }),
    contentServiceTimeoutMilliseconds: positiveInteger(
      environment,
      "CONTENT_SERVICE_TIMEOUT_MILLISECONDS",
      2_000,
    ),
    namespace,
  };
}

export const referenceApplicationConfig = getReferenceApplicationConfig(process.env);
