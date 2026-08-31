"use client"

import { RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT } from "@/lib/recommendation-consent"

type RecommendationCookieSettingsTriggerProps = Readonly<{
  label: string
}>

export function RecommendationCookieSettingsTrigger({
  label,
}: RecommendationCookieSettingsTriggerProps) {
  return (
    <button
      type="button"
      className="mt-1 block text-left hover:text-[#cb333b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cb333b]"
      onClick={(event) =>
        window.dispatchEvent(
          new CustomEvent(RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT, {
            detail: event.currentTarget,
          }),
        )
      }
    >
      {label}
    </button>
  )
}
