"use server";

import { revalidatePath } from "next/cache";

import { referenceApplicationConfig } from "../../../lib/application-config";
import { validatePublicContentDimensions } from "../../../lib/content-client";

export async function revalidatePathCacheDemo(formData: FormData): Promise<void> {
  const slug = formData.get("slug");
  if (typeof slug !== "string") throw new Error("A content slug is required");

  const dimensions = validatePublicContentDimensions({
    ...referenceApplicationConfig.content,
    slug,
  });
  revalidatePath(`/path-cache-demo/${dimensions.slug}`);
}
