"use client"

import { useSyncExternalStore } from "react"
import {
  getGeneratePending,
  getSearchPending,
  requestGenerate,
  setGeneratePending,
  subscribeToGeneratePending,
  subscribeToSearchPending,
} from "@/lib/demo-generate-bus"

type GenerateShortcutButtonProps = {
  // When true, the input next to this button is empty. We disable the
  // button so the user can't click Generate without a prompt.
  emptyQuery?: boolean
}

// Rendered inline next to the big search input as the page's hero CTA.
// Publishes to the generate-bus; the AiExperienceGeneratorDemo further down
// the page is the subscriber that actually runs, shows progress, and
// handles success + scroll. Mirrors the shared pending state so both
// generate buttons (this one and the one inside the AI section) show the
// same spinner / disabled affordance.
export function GenerateShortcutButton({
  emptyQuery = false,
}: GenerateShortcutButtonProps = {}) {
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
  // `searching` alone is the right navigation-pending signal —
  // DemoSearchInput raises it on every nav, the sentinel clears it on
  // Suspense resolve. Previously we also OR'd in !generatorMounted to
  // "match the skeleton", but that caused a spinner flash on every
  // cold load between sentinel render and its useEffect firing.
  const loading = searching
  const disabled = pending || loading || emptyQuery
  const label = loading ? "Loading…" : pending ? "Composing…" : "Generate"

  function handleClick() {
    if (emptyQuery) return
    if (loading) {
      // Subscriber is currently unmounted inside the Suspense fallback —
      // just queue by raising the pending flag. New mount will pick it up.
      setGeneratePending(true)
      return
    }
    requestGenerate()
  }

  const showSpinner = loading || pending
  const cursorClass =
    emptyQuery && !showSpinner
      ? "disabled:cursor-not-allowed"
      : "disabled:cursor-wait"

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-500 px-6 py-4 text-base font-semibold text-stone-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 hover:shadow-amber-500/40 disabled:opacity-70 ${cursorClass}`}
    >
      {showSpinner ? (
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
