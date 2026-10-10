"use client"

import { useSyncExternalStore } from "react"
import {
  getGeneratePending,
  getSearchPending,
  subscribeToGeneratePending,
  subscribeToSearchPending,
} from "@/lib/demo-generate-bus"
import { deriveGenerateButtonState } from "./generate-button-state"

// Rendered inside the Suspense fallback's skeleton. Reads the same bus
// signals as the hero + in-panel buttons so all three stay visually in
// sync during the fallback phase. Never clickable (no onClick; disabled
// forced to true regardless of the computed state).
export function SkeletonGenerateButton() {
  const generatePending = useSyncExternalStore(
    subscribeToGeneratePending,
    getGeneratePending,
    () => false,
  )
  const searchPending = useSyncExternalStore(
    subscribeToSearchPending,
    getSearchPending,
    () => false,
  )
  const state = deriveGenerateButtonState({
    searchPending,
    generatePending,
    emptyQuery: false,
    variant: "skeleton",
  })

  return (
    <button
      type="button"
      disabled
      className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-stone-950 transition disabled:cursor-wait disabled:opacity-70"
    >
      {state.showSpinner && (
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
      )}
      {state.label}
    </button>
  )
}
