export default function CacheDemoLoading() {
  return (
    <main aria-busy="true" className="grid min-h-screen place-items-center px-4 py-10 sm:px-8">
      <section className="w-full max-w-3xl rounded-3xl border border-outline bg-panel p-8 shadow-panel sm:p-12">
        <p className="text-xs font-bold tracking-[0.14em] text-accent uppercase">
          Stable App Shell
        </p>
        <h1 className="mt-3 text-4xl leading-none font-black tracking-[-0.05em] sm:text-6xl">
          Cache Components demo
        </h1>
        <p className="mt-8 rounded-2xl bg-accent-soft p-5 leading-7 text-muted italic">
          Preparing the route shell…
        </p>
      </section>
    </main>
  );
}
