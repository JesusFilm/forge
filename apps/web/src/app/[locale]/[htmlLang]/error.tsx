"use client"

import { useEffect } from "react"
import { useTranslations } from "next-intl"

import { reportDatadogRumError } from "@/components/DatadogRum"
import { ExperienceError } from "@/components/ExperienceError"

// Segment-level fallback for unexpected root/home/languages render errors.
// Resolver errors are handled inline in the page components when possible.
export default function WatchLocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations("ExperienceError")
  useEffect(() => {
    reportDatadogRumError(error, { boundary: "watch-locale" })
    if (process.env.NODE_ENV !== "production") {
      console.error("[watch-locale] error boundary caught:", error)
    }
  }, [error])

  return (
    <main className="min-h-screen bg-stone-900 text-stone-100">
      <ExperienceError message="Something went wrong loading this page." />
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-8">
        <button
          type="button"
          onClick={reset}
          className="rounded-full border border-amber-400 px-4 py-2 text-base sm:text-sm font-semibold text-amber-400 transition hover:bg-amber-400 hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          {t("tryAgain")}
        </button>
      </div>
    </main>
  )
}
