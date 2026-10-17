"use client"

import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"

const FOCUSABLE_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

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
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    titleRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose()
      if (event.key !== "Tab") return
      // The modal is not a native <dialog>, so keep Tab / Shift+Tab inside it
      // by hand (wrapping at both ends) instead of letting focus reach the
      // page behind the backdrop.
      const dialog = dialogRef.current
      if (!dialog) return
      const items = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      )
      const active = document.activeElement
      if (items.length === 0) {
        event.preventDefault()
        titleRef.current?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (!dialog.contains(active) || active === titleRef.current) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      const dialog = dialogRef.current
      if (
        dialog &&
        event.target instanceof Node &&
        !dialog.contains(event.target)
      )
        titleRef.current?.focus()
    }
    window.addEventListener("keydown", onKeyDown)
    document.addEventListener("focusin", onFocusIn)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("focusin", onFocusIn)
      document.body.style.overflow = previousBodyOverflow
    }
  }, [busy, onClose, open])

  if (!open) return null
  return (
    <div
      data-testid="recommendation-cookie-settings-viewport"
      className="fixed inset-0 z-[110] flex overflow-x-hidden overflow-y-auto bg-black/75 p-4"
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recommendation-cookie-settings-title"
        className="m-auto w-full max-w-xl shrink-0 rounded-2xl border border-stone-700 bg-stone-950 p-6 text-white shadow-2xl"
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
