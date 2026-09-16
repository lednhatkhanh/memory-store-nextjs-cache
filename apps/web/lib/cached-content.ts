import { cacheLife, cacheTag } from "next/cache";

import {
  getPublishedDocument,
  type PublicContentDimensions,
  type PublishedDocument,
  validatePublicContentDimensions,
} from "./content-client";

const defaultContentServiceUrl = "http://127.0.0.1:3100";

export function getPublishedDocumentCacheTag(dimensions: PublicContentDimensions): string {
  const validated = validatePublicContentDimensions(dimensions);
  return `published-document:${validated.site}:${validated.locale}:${validated.slug}`;
}

export async function getCachedPublishedDocument(
  dimensions: PublicContentDimensions,
): Promise<PublishedDocument> {
  return readPublishedDocument(validatePublicContentDimensions(dimensions));
}

async function readPublishedDocument(
  dimensions: PublicContentDimensions,
): Promise<PublishedDocument> {
  "use cache: remote";
  cacheLife("publishedContent");
  cacheTag(getPublishedDocumentCacheTag(dimensions));

  return getPublishedDocument(
    process.env["CONTENT_SERVICE_URL"] ?? defaultContentServiceUrl,
    dimensions,
  );
}
