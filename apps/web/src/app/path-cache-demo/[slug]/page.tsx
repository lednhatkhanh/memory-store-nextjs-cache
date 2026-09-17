import type { Metadata } from "next";
import { io } from "next/cache";
import { Suspense } from "react";

import { Button } from "../../../components/button";
import { Link } from "../../../components/link";
import { MarkdownContent } from "../../../components/markdown-content";
import { getCachedPublishedDocument } from "../../../lib/cached-content";
import { revalidatePathCacheDemo } from "./actions";

export const instant = true;

export async function generateMetadata({
  params,
}: PageProps<"/path-cache-demo/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const document = await getCachedPublishedDocument(
    { locale: "en", site: "reference", slug },
    "metadata",
  );

  return {
    description: `${document.body} (${document.revision})`,
    title: document.title,
  };
}

export default function PathCacheDemoPage({ params }: PageProps<"/path-cache-demo/[slug]">) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10 sm:px-8">
      <section className="w-full max-w-3xl rounded-3xl border border-outline bg-panel p-8 shadow-panel sm:p-12">
        <p className="text-xs font-bold tracking-[0.14em] text-accent uppercase">
          Implicit route tags
        </p>
        <h1 className="mt-3 text-4xl leading-none font-black tracking-[-0.05em] sm:text-6xl">
          Path revalidation demo
        </h1>
        <p className="mt-5 max-w-2xl leading-7 text-muted">
          The page, its metadata, and its segment layout each cache a route dependency in Redis.
        </p>
        <Suspense
          fallback={
            <p className="my-8 rounded-2xl bg-accent-soft p-5 leading-7 text-muted italic">
              Streaming the page dependency…
            </p>
          }
        >
          <PageDependency params={params} />
        </Suspense>
        <Link
          className="rounded-sm font-bold text-accent underline decoration-2 underline-offset-4 data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-accent data-hovered:decoration-4 data-pressed:opacity-75"
          href="/"
        >
          Return home
        </Link>
      </section>
    </main>
  );
}

async function PageDependency({
  params,
}: {
  params: PageProps<"/path-cache-demo/[slug]">["params"];
}) {
  const { slug } = await params;
  await io();
  const document = await getCachedPublishedDocument(
    { locale: "en", site: "reference", slug },
    "page",
  );

  return (
    <>
      <article
        className="my-8 rounded-2xl border border-outline bg-accent-soft p-5 sm:p-7"
        data-cache-dependency="page"
        data-page-revision={document.revision}
      >
        <h2 className="text-2xl font-black tracking-tight">{document.title}</h2>
        <div className="mt-4">
          <MarkdownContent>{document.body}</MarkdownContent>
        </div>
        <p className="mt-6 border-t border-outline pt-4 font-mono text-xs leading-5 text-muted">
          Revision {document.revision}
        </p>
      </article>
      <form action={revalidatePathCacheDemo} className="mb-6">
        <input name="slug" type="hidden" value={slug} />
        <Button
          className="rounded-full border border-outline px-5 py-3 font-bold text-accent transition data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-accent data-hovered:bg-accent-soft data-pressed:brightness-95"
          type="submit"
        >
          Revalidate this path
        </Button>
      </form>
    </>
  );
}
