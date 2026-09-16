import { revalidateTag } from "next/cache";

import { getPublishedDocumentCacheTag } from "../../../../lib/cached-content";
import {
  type PublicContentDimensions,
  validatePublicContentDimensions,
} from "../../../../lib/content-client";

type RevalidationRequest = PublicContentDimensions & {
  policy?: "stale-while-revalidate";
};

function isRevalidationRequest(value: unknown): value is RevalidationRequest {
  const policy =
    typeof value === "object" && value !== null ? Reflect.get(value, "policy") : undefined;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "site") === "string" &&
    typeof Reflect.get(value, "locale") === "string" &&
    typeof Reflect.get(value, "slug") === "string" &&
    (policy === undefined || policy === "stale-while-revalidate")
  );
}

export async function POST(request: Request): Promise<Response> {
  const revalidationSecret = process.env["REVALIDATION_SECRET"];
  if (!revalidationSecret) {
    return Response.json({ message: "Revalidation is not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${revalidationSecret}`) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "Invalid JSON body" }, { status: 400 });
  }
  if (!isRevalidationRequest(body)) {
    return Response.json({ message: "Invalid content dimensions" }, { status: 400 });
  }

  let dimensions: PublicContentDimensions;
  try {
    dimensions = validatePublicContentDimensions(body);
  } catch {
    return Response.json({ message: "Invalid content dimensions" }, { status: 400 });
  }

  revalidateTag(
    getPublishedDocumentCacheTag(dimensions),
    body.policy === "stale-while-revalidate" ? "briefStaleContentRefresh" : { expire: 0 },
  );
  return Response.json({ revalidated: true });
}
