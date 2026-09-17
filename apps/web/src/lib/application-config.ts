import { createCacheNamespace, type CacheNamespace } from "unicorn-nextjs-memory-cache";

import type { PublicContentDimensions } from "./content-client";

type Environment = Readonly<Record<string, string | undefined>>;

export type ReferenceApplicationConfig = Readonly<{
  content: Pick<PublicContentDimensions, "locale" | "site">;
  namespace: CacheNamespace;
}>;

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

  return { content: { locale, site }, namespace };
}

export const referenceApplicationConfig = getReferenceApplicationConfig(process.env);
