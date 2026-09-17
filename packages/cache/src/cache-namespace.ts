import { createHash } from "node:crypto";

export type CacheNamespaceInput = Readonly<{
  application: string;
  environment: string;
  locale: string;
  release: string;
  site: string;
}>;

const cacheNamespaceBrand: unique symbol = Symbol("cache-namespace");

export type CacheNamespace = Readonly<{
  [cacheNamespaceBrand]: true;
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
  const namespace = {
    [cacheNamespaceBrand]: true as const,
    deployment,
    release: digest(["cache-release", 1, deployment, input.release]),
  };
  Object.defineProperty(namespace, cacheNamespaceBrand, { enumerable: false });
  return Object.freeze(namespace);
}

export function isCacheNamespace(value: unknown): value is CacheNamespace {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, cacheNamespaceBrand) === true &&
    /^[a-f\d]{64}$/u.test(String(Reflect.get(value, "deployment"))) &&
    /^[a-f\d]{64}$/u.test(String(Reflect.get(value, "release")))
  );
}
