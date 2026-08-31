"use client"

import { useTranslations } from "next-intl"

export function RecommendationCookieBanner({
  busy,
  error,
  onAcceptAll,
  onEssentialOnly,
  onManage,
}: {
  busy: boolean
  error: string | null
  onAcceptAll: () => void
  onEssentialOnly: () => void
  onManage: (trigger: HTMLButtonElement) => void
}) {
  const t = useTranslations("RecommendationConsent")
  return (
    <section
      aria-label={t("bannerLabel")}
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-4xl rounded-2xl border border-stone-600 bg-stone-950/95 p-5 text-white shadow-2xl backdrop-blur md:inset-x-6 md:flex md:items-end md:gap-8 md:p-6"
    >
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold">{t("bannerTitle")}</p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-300">
          {t("bannerDescription")}
        </p>
        {error && (
          <p className="mt-2 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="mt-4 grid shrink-0 gap-2 sm:grid-cols-3 md:mt-0">
        <button
          type="button"
          disabled={busy}
          onClick={onAcceptAll}
          className="rounded-full bg-red-500 px-5 py-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-60"
        >
          {t("acceptAll")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onEssentialOnly}
          className="rounded-full border border-stone-500 px-5 py-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-60"
        >
          {t("essentialOnly")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={(event) => onManage(event.currentTarget)}
          className="rounded-full px-5 py-3 text-sm font-semibold text-stone-200 underline decoration-stone-500 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-60"
        >
          {t("manageChoices")}
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {busy ? t("savingChoice") : ""}
      </span>
    </section>
  )
}
