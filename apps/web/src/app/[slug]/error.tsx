"use client"

import { useEffect } from "react"

import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"
import { WatchPageAdminError } from "@/lib/content"

/**
 * Slug-page error boundary, additive for admin-mode WatchPageAdminError
 * throws. `error.message` MUST NEVER render (info disclosure). Non-typed
 * errors re-throw to Next's segment-default. See plan-003 UB7.
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
