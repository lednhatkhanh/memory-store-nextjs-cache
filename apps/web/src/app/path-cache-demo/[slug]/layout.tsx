import { Suspense } from "react";

import { referenceApplicationConfig } from "../../../lib/application-config";
import { getCachedPublishedDocument } from "../../../lib/cached-content";

export default function PathCacheDemoLayout({
  children,
  params,
}: LayoutProps<"/path-cache-demo/[slug]">) {
  return (
    <>
      <Suspense fallback={<p className="sr-only">Loading the route layout dependency…</p>}>
        <RouteLayoutDependency params={params} />
      </Suspense>
      {children}
    </>
  );
}

async function RouteLayoutDependency({
  params,
}: {
  params: LayoutProps<"/path-cache-demo/[slug]">["params"];
}) {
  const { slug } = await params;
  const document = await getCachedPublishedDocument(
    { ...referenceApplicationConfig.content, slug },
    "layout",
  );

  return (
    <aside
      className="border-b border-outline bg-accent-soft px-4 py-3 text-center font-mono text-xs text-muted"
      data-cache-dependency="layout"
      data-layout-revision={document.revision}
    >
      Revision {document.revision}
    </aside>
  );
}
