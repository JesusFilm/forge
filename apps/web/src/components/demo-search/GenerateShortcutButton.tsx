"use client"

import { useSyncExternalStore } from "react"
import {
  getGeneratePending,
  requestGenerate,
  subscribeToGeneratePending,
} from "@/lib/demo-generate-bus"

// Renders a compact "Generate" CTA directly under the search input so
// stakeholders don't have to scroll to find the primary action. Publishes
// to the generate-bus; the AiExperienceGeneratorDemo further down the page
// is the subscriber that actually runs, shows progress, and handles
// success + scroll-to-output. Mirrors the shared pending state so this
// button shows the same spinner / disabled affordance as the main one.
export function GenerateShortcutButton() {
  const pending = useSyncExternalStore(
    subscribeToGeneratePending,
    getGeneratePending,
    () => false,
  )

  return (
    <div className="mt-4 flex justify-center">
      <button
        type="button"
        onClick={requestGenerate}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-stone-950 transition hover:bg-amber-400 disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? (
          <svg
            className="h-4 w-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : (
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
          </svg>
        )}
        {pending ? "Composing…" : "Generate experience with AI"}
      </button>
    </div>
  )
}
