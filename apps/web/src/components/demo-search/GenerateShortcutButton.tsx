"use client"

import { useSyncExternalStore } from "react"
import {
  getGeneratePending,
  getSearchPending,
  requestGenerate,
  subscribeToGeneratePending,
  subscribeToSearchPending,
} from "@/lib/demo-generate-bus"

// Rendered inline next to the big search input as the page's hero CTA.
// Publishes to the generate-bus; the AiExperienceGeneratorDemo further down
// the page is the subscriber that actually runs, shows progress, and
// handles success + scroll. Mirrors the shared pending state so both
// generate buttons (this one and the one inside the AI section) show the
// same spinner / disabled affordance.
export function GenerateShortcutButton() {
  const pending = useSyncExternalStore(
    subscribeToGeneratePending,
    getGeneratePending,
    () => false,
  )
  const searching = useSyncExternalStore(
    subscribeToSearchPending,
    getSearchPending,
    () => false,
  )
  const disabled = pending || searching
  const label = searching
    ? "Waiting for search to finish…"
    : pending
      ? "Composing…"
      : "Generate"

  return (
    <button
      type="button"
      onClick={requestGenerate}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-500 px-6 py-4 text-base font-semibold text-stone-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 hover:shadow-amber-500/40 disabled:cursor-wait disabled:opacity-70"
    >
      {disabled ? (
        <svg
          className="h-5 w-5 animate-spin"
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
          className="h-5 w-5"
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
      {label}
    </button>
  )
}
