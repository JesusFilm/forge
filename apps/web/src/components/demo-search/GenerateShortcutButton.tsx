"use client"

import { requestGenerate } from "@/lib/demo-generate-bus"

// Renders a compact "Generate" CTA directly under the search input so
// stakeholders don't have to scroll to find the primary action. Publishes
// to the generate-bus; the AiExperienceGeneratorDemo further down the page
// is the subscriber that actually runs, shows progress, and handles
// success + scroll-to-output.
export function GenerateShortcutButton() {
  return (
    <div className="mt-4 flex justify-center">
      <button
        type="button"
        onClick={requestGenerate}
        className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-stone-950 transition hover:bg-amber-400"
      >
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
        Generate experience with AI
      </button>
    </div>
  )
}
