/**
 * Static maintenance fallback rendered when `FORGE_DISABLE_WATCH_ROUTES`
 * lists the current slug. Layer 1 of the cutover-runbook rollback story —
 * the fastest emergency rollback surface (seconds; no redeploy).
 *
 * Intentionally static: NO admin/Strapi fetch, NO dynamic data, NO client
 * interactivity. This component is the failsafe — every dependency it
 * pulls in is another way for the failsafe to fail. Mirrors the shape of
 * <ExperienceEmpty> / <ExperienceError> so layout regressions are
 * impossible.
 *
 * Plan reference: docs/plans/2026-05-11-003-feat-web-admin-direct-cutover-plan.md U9.
 * Runbook reference: docs/admin-core-migration/cutover-runbook.md "Layer 1".
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
