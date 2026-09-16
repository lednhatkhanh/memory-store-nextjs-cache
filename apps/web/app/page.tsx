import { Link } from "../components/link";

export default function HomePage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10 sm:px-8">
      <section className="w-full max-w-3xl rounded-3xl border border-outline bg-panel p-8 shadow-panel sm:p-12">
        <p className="text-xs font-bold tracking-[0.14em] text-accent uppercase">
          Next.js cache handler reference
        </p>
        <h1 className="mt-3 text-4xl leading-none font-black tracking-[-0.05em] text-balance sm:text-6xl">
          Markdown content, cached remotely
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">
          Open either entry to keep the App Shell stable while CMS-shaped content streams through
          the shared Redis cache.
        </p>
        <nav aria-label="Cache demo entries" className="mt-8 flex flex-wrap gap-3">
          <Link
            className="rounded-full bg-accent px-5 py-3 font-bold text-white transition data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-accent data-hovered:brightness-95 data-pressed:brightness-90"
            href="/cache-demo/alpha"
          >
            Open alpha
          </Link>
          <Link
            className="rounded-full border border-outline px-5 py-3 font-bold text-accent transition data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-accent data-hovered:bg-accent-soft data-pressed:brightness-95"
            href="/cache-demo/beta"
          >
            Open beta
          </Link>
        </nav>
      </section>
    </main>
  );
}
