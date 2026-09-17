import ky, { type Options } from "ky";

export type ContentServiceHealth = {
  status: "ok";
};

export type PublicContentDimensions = {
  locale: string;
  site: string;
  slug: string;
};

export type PublicContentPartition = Pick<PublicContentDimensions, "locale" | "site">;

export type PublishedDocument = PublicContentDimensions & {
  body: string;
  revision: string;
  title: string;
};

const publicDimensionPatterns = {
  locale: /^[a-z]{2}(?:-[A-Z]{2})?$/u,
  site: /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
} as const;

export function validatePublicContentDimensions(
  dimensions: PublicContentDimensions,
): PublicContentDimensions {
  validatePublicContentPartition(dimensions);
  if (!publicDimensionPatterns.slug.test(dimensions.slug)) {
    throw new Error("Invalid public content slug");
  }
  return dimensions;
}

export function validatePublicContentPartition(
  partition: PublicContentPartition,
): PublicContentPartition {
  for (const dimension of ["site", "locale"] as const) {
    if (!publicDimensionPatterns[dimension].test(partition[dimension])) {
      throw new Error(`Invalid public content ${dimension}`);
    }
  }
  return partition;
}

export async function getContentServiceHealth(
  url: string | URL,
  options: Pick<Options, "fetch"> = {},
): Promise<ContentServiceHealth> {
  return ky.get(url, { ...options, retry: 0 }).json<ContentServiceHealth>();
}

export async function getPublishedDocument(
  serviceUrl: string | URL,
  dimensions: PublicContentDimensions,
  options: Pick<Options, "fetch"> = {},
): Promise<PublishedDocument> {
  const validated = validatePublicContentDimensions(dimensions);
  const baseUrl = new URL(serviceUrl);
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/u, "")}/documents/${validated.site}/${validated.locale}/${validated.slug}`;

  return ky.get(baseUrl, { ...options, retry: 0 }).json<PublishedDocument>();
}
