"use client"

import { useEffect } from "react"

import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"

/**
 * Slug-page error boundary, additive for admin-mode WatchPageAdminError
 * throws. `error.message` MUST NEVER render (info disclosure). Non-typed
 * errors re-throw to Next's segment-default. See plan-003 UB7.
 *
 * F7 (ce-code-review): duck-type the error rather than `instanceof`
 * WatchPageAdminError. Next.js serializes thrown errors across the
 * SSR→client boundary into plain shapes — class identity is unreliable.
 * The tests construct the error directly in jsdom, masking the gap.
 * Checking `name` + `code` shape is unconditionally safer.
 */
function isWatchPageAdminError(
  error: unknown,
): error is { name: "WatchPageAdminError"; code: "NOT_FOUND" | "UNAVAILABLE" } {
  if (error == null || typeof error !== "object") return false
  const e = error as { name?: unknown; code?: unknown }
  if (e.name !== "WatchPageAdminError") return false
  return e.code === "NOT_FOUND" || e.code === "UNAVAILABLE"
}

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

  if (isWatchPageAdminError(error)) {
    if (error.code === "NOT_FOUND") {
      return <ExperienceEmpty />
    }
    if (error.code === "UNAVAILABLE") {
      // SECURITY: never pass error.message; feed ExperienceError a stable
      // string that maps to its KNOWN_ERRORS generic fallback.
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

  // Re-throw to Next's segment-default (generic 500 without echoing message).
  throw error
}
