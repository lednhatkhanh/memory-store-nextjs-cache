import { Link } from "../components/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10 sm:px-8">
      <section className="w-full max-w-3xl rounded-3xl border border-outline bg-panel p-8 shadow-panel sm:p-12">
        <p className="text-xs font-bold tracking-[0.14em] text-accent uppercase">
          Published content not found
        </p>
        <h1 className="mt-3 text-4xl leading-none font-black tracking-[-0.05em] sm:text-6xl">
          This document is no longer available
        </h1>
        <p className="mt-5 max-w-2xl leading-7 text-muted">
          The content service confirmed that this public document does not exist.
        </p>
        <Link
          className="mt-8 inline-block rounded-sm font-bold text-accent underline decoration-2 underline-offset-4 data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-accent data-hovered:decoration-4 data-pressed:opacity-75"
          href="/"
        >
          Choose another entry
        </Link>
      </section>
    </main>
  );
}
