"use client"

import { useEffect } from "react"

import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"
import { WatchPageAdminError } from "@/lib/content"

/**
 * Slug-page error boundary — additive in admin mode only.
 *
 * The boundary catches the typed `WatchPageAdminError` that
 * `fetchSlugExperience` throws when admin returns null or fails (admin
 * mode only; Strapi-mode errors continue through the existing sentinel
 * path in `page.tsx` and never reach this boundary).
 *
 * Information-disclosure discipline: `error.message` is NEVER rendered as
 * visible text. The classifier dispatches on `error.code` and renders one
 * of two static UX shapes that match the Strapi-mode inline rendering of
 * `<ExperienceEmpty>` / `<ExperienceError>` — end users see no behavior
 * difference between admin-mode and Strapi-mode failures.
 *
 * Catch-all behavior: any non-typed error that escapes here (defense
 * against unexpected throws) re-throws to Next.js's segment-default error
 * boundary. That route emits a generic 500 page without echoing the
 * underlying error.message. The boundary's safe contract: "renders
 * `<ExperienceEmpty>` for NOT_FOUND, `<ExperienceError>` with reset for
 * UNAVAILABLE, re-throws everything else."
 *
 * Pattern follows `apps/web/src/app/[slug]/[locale]/error.tsx`.
 *
 * Plan reference: docs/plans/2026-05-11-003-feat-web-admin-direct-cutover-plan.md UB7.
 */
export default function SlugPageError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("[slug-page] error boundary caught:", error)
    }
  }, [error])

  if (error instanceof WatchPageAdminError) {
    if (error.code === "NOT_FOUND") {
      return <ExperienceEmpty />
    }
    if (error.code === "UNAVAILABLE") {
      // Generic operator-facing message — NEVER pass error.message through.
      // ExperienceError additionally sanitizes via its KNOWN_ERRORS table;
      // we feed it a stable "service unavailable" string that maps to its
      // generic fallback, so admin-mode UNAVAILABLE and Strapi-mode
      // generic-error renderings stay visually consistent.
      return (
        <main className="min-h-screen bg-stone-900 text-stone-100">
          <ExperienceError message="Service temporarily unavailable" />
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-8">
            <button
              type="button"
              onClick={reset}
              className="rounded-full border border-amber-400 px-4 py-2 text-sm font-semibold text-amber-400 transition hover:bg-amber-400 hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              Try again
            </button>
          </div>
        </main>
      )
    }
  }

  // Unexpected error — re-throw to Next's segment-default boundary.
  // The default renders a generic 500 page without echoing error.message.
  throw error
}
