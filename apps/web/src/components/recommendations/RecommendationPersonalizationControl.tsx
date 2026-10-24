"use client"

import { useTranslations } from "next-intl"

import { RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT } from "@/lib/recommendation-consent-events"

export function RecommendationPersonalizationControl() {
  const t = useTranslations("VideoRecommendations")
  return (
    <section
      aria-label={t("personalizationLabel")}
      className="mt-4 text-sm text-stone-400"
    >
      {t("personalizationPrompt")}{" "}
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
        {t("openCookieSettings")}
      </button>
    </section>
  )
}
