"use client"

import { RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT } from "@/lib/recommendation-consent"

export function RecommendationPersonalizationControl() {
  return (
    <section
      aria-label="Recommendation personalization"
      className="mt-4 text-sm text-stone-400"
    >
      Want to change how recommendations are personalized?{" "}
      <button
        type="button"
        className="font-semibold text-stone-200 underline decoration-stone-600 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        onClick={(event) =>
          window.dispatchEvent(
            new CustomEvent(RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT, {
              detail: event.currentTarget,
            }),
          )
        }
      >
        Open cookie settings
      </button>
    </section>
  )
}
