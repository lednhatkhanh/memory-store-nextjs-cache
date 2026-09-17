import { createHash } from "node:crypto";

export type CacheNamespaceInput = Readonly<{
  application: string;
  environment: string;
  locale: string;
  release: string;
  site: string;
}>;

export type CacheNamespace = Readonly<{
  deployment: string;
  release: string;
}>;

const deploymentDimensionPattern = /^[a-z0-9](?:[a-z0-9._-]{0,62})$/u;
const localePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/u;
const releasePattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/u;

function digest(value: readonly (number | string)[]): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertNamespaceDimension(
  dimension: keyof CacheNamespaceInput,
  value: string,
  pattern: RegExp,
): void {
  if (!pattern.test(value)) {
    throw new Error(`Invalid cache namespace ${dimension}`);
  }
}

export function createCacheNamespace(input: CacheNamespaceInput): CacheNamespace {
  assertNamespaceDimension("application", input.application, deploymentDimensionPattern);
  assertNamespaceDimension("environment", input.environment, deploymentDimensionPattern);
  assertNamespaceDimension("site", input.site, deploymentDimensionPattern);
  assertNamespaceDimension("locale", input.locale, localePattern);
  assertNamespaceDimension("release", input.release, releasePattern);

  const deployment = digest([
    "cache-namespace",
    1,
    input.application,
    input.environment,
    input.site,
    input.locale,
  ]);
  return {
    deployment,
    release: digest(["cache-release", 1, deployment, input.release]),
  };
}
