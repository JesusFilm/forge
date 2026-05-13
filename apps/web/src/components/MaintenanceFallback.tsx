/**
 * Static fallback for slugs listed in FORGE_DISABLE_WATCH_ROUTES. Fastest
 * emergency rollback (seconds; no redeploy). MUST stay static — no fetch,
 * no dynamic data, no client interactivity. Every dependency is another
 * way the failsafe can fail.
 */
export function MaintenanceFallback() {
  return (
    <main className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-8">
      <h1 className="text-xl font-semibold text-stone-200">
        Temporarily unavailable
      </h1>
      <p className="text-base text-stone-400">
        This page is undergoing maintenance. Please check back shortly.
      </p>
    </main>
  )
}
