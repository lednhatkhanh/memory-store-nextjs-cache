import { io } from "next/cache";
import { Suspense } from "react";

import { Link } from "../../../components/link";
import { MarkdownContent } from "../../../components/markdown-content";
import { getCachedPublishedDocument } from "../../../lib/cached-content";

export const instant = true;

export default function CacheDemoPage({ params }: PageProps<"/cache-demo/[slug]">) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10 sm:px-8">
      <section className="w-full max-w-3xl rounded-3xl border border-outline bg-panel p-8 shadow-panel sm:p-12">
        <p className="text-xs font-bold tracking-[0.14em] text-accent uppercase">
          Stable App Shell
        </p>
        <h1 className="mt-3 text-4xl leading-none font-black tracking-[-0.05em] sm:text-6xl">
          Cache Components demo
        </h1>
        <p className="mt-5 max-w-2xl leading-7 text-muted">
          This shell stays stable while request-time Markdown streams into the panel below.
        </p>
        <Suspense
          fallback={
            <p className="my-8 rounded-2xl bg-accent-soft p-5 leading-7 text-muted italic">
              Streaming published content…
            </p>
          }
        >
          <FreshRequestDetails params={params} />
        </Suspense>
        <Link
          className="rounded-sm font-bold text-accent underline decoration-2 underline-offset-4 data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-accent data-hovered:decoration-4 data-pressed:opacity-75"
          href="/"
        >
          Choose another entry
        </Link>
      </section>
    </main>
  );
}

async function FreshRequestDetails({
  params,
}: {
  params: PageProps<"/cache-demo/[slug]">["params"];
}) {
  const { slug } = await params;

  await io();

  const document = await getCachedPublishedDocument({
    locale: "en",
    site: "reference",
    slug,
  });

  return (
    <article className="my-8 rounded-2xl border border-outline bg-accent-soft p-5 sm:p-7">
      <h2 className="text-2xl font-black tracking-tight">{document.title}</h2>
      <div className="mt-4">
        <MarkdownContent>{document.body}</MarkdownContent>
      </div>
      <p className="mt-6 border-t border-outline pt-4 font-mono text-xs leading-5 text-muted">
        Revision {document.revision} · {document.site}/{document.locale}/{document.slug}
      </p>
    </article>
  );
}
