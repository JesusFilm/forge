"use client"

import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"

export function RecommendationCookieSettings({
  open,
  personalization,
  busy,
  error,
  erasurePending,
  onPersonalizationChange,
  onSave,
  onClose,
}: {
  open: boolean
  personalization: boolean
  busy: boolean
  error: string | null
  erasurePending: boolean
  onPersonalizationChange: (enabled: boolean) => void
  onSave: () => void
  onClose: () => void
}) {
  const t = useTranslations("RecommendationConsent")
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!open) return
    titleRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [busy, onClose, open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="recommendation-cookie-settings-title"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-stone-700 bg-stone-950 p-6 text-white shadow-2xl"
      >
        <h2
          id="recommendation-cookie-settings-title"
          ref={titleRef}
          tabIndex={-1}
          className="text-2xl font-semibold outline-none"
        >
          {t("settings")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-stone-300">
          {t("settingsDescription")}
        </p>
        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-stone-700 p-4">
            <div>
              <p className="font-semibold">{t("essentialCookies")}</p>
              <p className="mt-1 text-xs text-stone-400">
                {t("essentialDescription")}
              </p>
            </div>
            <span className="ml-4 shrink-0 text-sm font-semibold text-green-300">
              {t("alwaysActive")}
            </span>
          </div>
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-stone-700 p-4">
            <span>
              <span className="block font-semibold">
                {t("personalization")}
              </span>
              <span className="mt-1 block text-xs text-stone-400">
                {t("personalizationDescription")}
              </span>
            </span>
            <input
              name="recommendation-personalization"
              type="checkbox"
              checked={personalization}
              disabled={busy}
              onChange={(event) =>
                onPersonalizationChange(event.currentTarget.checked)
              }
              className="ml-4 size-5 accent-red-500"
            />
          </label>
        </div>
        {erasurePending && (
          <p className="mt-4 text-sm text-amber-200" role="status">
            {t("erasurePending")}
          </p>
        )}
        {error && (
          <p className="mt-4 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-full border border-stone-600 px-5 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSave}
            className="rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? t("saving") : t("saveChoices")}
          </button>
        </div>
      </section>
    </div>
  )
}
