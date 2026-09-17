"use client";

import { Button } from "../../../components/button";

export default function PathCacheDemoError({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10 sm:px-8">
      <section className="w-full max-w-3xl rounded-3xl border border-outline bg-panel p-8 shadow-panel sm:p-12">
        <p className="text-xs font-bold tracking-[0.14em] text-accent uppercase">
          Route dependencies unavailable
        </p>
        <h1 className="mt-3 text-4xl leading-none font-black tracking-[-0.05em] sm:text-6xl">
          We could not load this cached path
        </h1>
        <p className="mt-5 max-w-2xl leading-7 text-muted">
          The application shell is still available. Try loading the page, layout, and metadata
          dependencies again.
        </p>
        <Button
          className="mt-8 rounded-full bg-accent px-5 py-3 font-bold text-white transition data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-accent data-hovered:brightness-95 data-pressed:brightness-90"
          onPress={reset}
        >
          Try again
        </Button>
      </section>
    </main>
  );
}
