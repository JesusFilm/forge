"use client"

import { useMemo, useState, useTransition } from "react"
import {
  Check,
  CircleAlert,
  CircleDashed,
  RefreshCcw,
  Save,
  Sparkles,
  UserRound,
  X,
} from "lucide-react"
import { cx } from "@/components/admin-ui"
import { ToastStack, useToastStack } from "@/components/toast-stack"

type LocaleActionResult =
  | { ok: true }
  | {
      ok: false
      error: "forbidden" | "validation" | "unknown"
      message: string
    }

export type MediaAssetLocaleRow = {
  id: string
  locale: string
  displayName: string | null
  altText: string | null
  displayNameSource: "USER" | "AI" | "SYSTEM" | null
  altTextSource: "USER" | "AI" | "SYSTEM" | null
  displayNameLocked: boolean
  altTextLocked: boolean
  status: "WAITING" | "PROCESSING" | "COMPLETE" | "FAILED" | "SKIPPED"
  errorMessage: string | null
  updatedAtLabel: string
}

type FilterValue = "all" | "needs-review" | "failed" | "protected"

type MediaLocalizationModalProps = {
  open: boolean
  assetId: string
  assetName: string
  previewUrl: string | null
  locales: MediaAssetLocaleRow[]
  canEdit: boolean
  onClose: () => void
  onUpdateLocale: (formData: FormData) => Promise<LocaleActionResult>
  onRetryEnrichment: (formData: FormData) => Promise<LocaleActionResult>
}

function localeStatusTone(status: MediaAssetLocaleRow["status"]) {
  if (status === "COMPLETE") return "bg-[var(--color-success)]"
  if (status === "FAILED") return "bg-[var(--color-danger)]"
  if (status === "PROCESSING") return "bg-[var(--color-info)]"
  if (status === "WAITING") return "bg-[var(--color-warning)]"
  return "bg-[var(--color-text-muted)]"
}

function matchesFilter(locale: MediaAssetLocaleRow, filter: FilterValue) {
  if (filter === "all") return true
  if (filter === "failed") return locale.status === "FAILED"
  if (filter === "protected")
    return locale.displayNameLocked || locale.altTextLocked
  return (
    locale.status === "WAITING" ||
    locale.status === "PROCESSING" ||
    locale.status === "FAILED" ||
    !locale.displayName ||
    !locale.altText
  )
}

export function MediaLocalizationModal({
  open,
  assetId,
  assetName,
  previewUrl,
  locales,
  canEdit,
  onClose,
  onUpdateLocale,
  onRetryEnrichment,
}: MediaLocalizationModalProps) {
  const [filter, setFilter] = useState<FilterValue>("all")
  const [activeLocale, setActiveLocale] = useState(locales[0]?.locale ?? "en")
  const [isPending, startTransition] = useTransition()
  const [isRetryPending, startRetryTransition] = useTransition()
  const { toasts, pushToast, dismissToast } = useToastStack()

  const visibleLocales = useMemo(
    () => locales.filter((locale) => matchesFilter(locale, filter)),
    [filter, locales],
  )
  const active =
    locales.find((locale) => locale.locale === activeLocale) ??
    visibleLocales[0] ??
    locales[0] ??
    null
  const protectedCount = locales.filter(
    (locale) => locale.displayNameLocked || locale.altTextLocked,
  ).length
  const failedCount = locales.filter(
    (locale) => locale.status === "FAILED",
  ).length
  const completeCount = locales.filter(
    (locale) => locale.status === "COMPLETE",
  ).length

  if (!open) return null

  function saveLocale(formData: FormData) {
    startTransition(async () => {
      const result = await onUpdateLocale(formData)
      if (!result.ok) {
        pushToast(result.message, "error")
        return
      }
      pushToast("Localized metadata saved.", "success")
    })
  }

  function retryEnrichment() {
    const formData = new FormData()
    formData.set("mediaAssetId", assetId)
    startRetryTransition(async () => {
      const result = await onRetryEnrichment(formData)
      if (!result.ok) {
        pushToast(result.message, "error")
        return
      }
      pushToast("Image enrichment queued.", "success")
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,6,10,0.72)] px-4 py-5 backdrop-blur-[6px]">
      <div className="flex h-[min(820px,calc(100vh-2.5rem))] w-full max-w-5xl flex-col overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
        <div className="hairline-strong-b flex flex-wrap items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[14px] font-medium text-[var(--color-text-primary)]">
              <Sparkles className="h-4 w-4" strokeWidth={1.5} />
              Image localizations
            </div>
            <div className="mt-1 truncate text-[12px] text-[var(--color-text-muted)]">
              {assetName}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit ? (
              <button
                type="button"
                onClick={retryEnrichment}
                disabled={isRetryPending}
                className="inline-flex h-8 items-center gap-2 rounded-sm border border-[var(--color-hairline)] px-3 text-[12px] text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                {isRetryPending ? "Queuing..." : "Retry AI-owned"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]"
              aria-label="Close localization modal"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]">
          <aside className="min-h-0 border-r border-[var(--color-hairline)] bg-[var(--color-surface-raised)]">
            <div className="grid grid-cols-3 gap-2 p-3 text-center">
              <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 py-2">
                <div className="text-[14px] font-medium">{completeCount}</div>
                <div className="mono-meta text-[var(--color-text-muted)]">
                  complete
                </div>
              </div>
              <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 py-2">
                <div className="text-[14px] font-medium">{protectedCount}</div>
                <div className="mono-meta text-[var(--color-text-muted)]">
                  human
                </div>
              </div>
              <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 py-2">
                <div className="text-[14px] font-medium">{failedCount}</div>
                <div className="mono-meta text-[var(--color-text-muted)]">
                  failed
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1 px-3 pb-3">
              {(
                [
                  ["all", "All"],
                  ["needs-review", "Needs"],
                  ["failed", "Failed"],
                  ["protected", "Human"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cx(
                    "h-8 rounded-sm border px-2 text-[12px] transition-all duration-[120ms] ease-out",
                    filter === value
                      ? "border-[var(--color-hairline-strong)] bg-[var(--color-bg)] text-[var(--color-text-primary)]"
                      : "border-[var(--color-hairline)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="min-h-0 overflow-y-auto border-t border-[var(--color-hairline)]">
              {visibleLocales.map((locale) => (
                <button
                  key={locale.id}
                  type="button"
                  onClick={() => setActiveLocale(locale.locale)}
                  className={cx(
                    "grid w-full gap-1 border-b border-[var(--color-hairline)] px-3 py-3 text-left transition-all duration-[120ms] ease-out",
                    active?.locale === locale.locale
                      ? "bg-[var(--color-bg)]"
                      : "hover:bg-[var(--color-surface)]",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={cx(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          localeStatusTone(locale.status),
                        )}
                      />
                      <span className="font-mono text-[12px]">
                        {locale.locale}
                      </span>
                      <span className="truncate text-[12px] text-[var(--color-text-secondary)]">
                        {locale.displayName || "Unnamed"}
                      </span>
                    </div>
                    {locale.displayNameLocked || locale.altTextLocked ? (
                      <UserRound
                        className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]"
                        strokeWidth={1.5}
                      />
                    ) : null}
                  </div>
                  <div className="mono-meta text-[var(--color-text-muted)]">
                    {locale.status} / {locale.updatedAtLabel}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <div className="hairline-strong-b flex items-center gap-3 px-4 py-3">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt=""
                  className="h-12 w-16 rounded-sm border border-[var(--color-hairline)] object-cover"
                />
              ) : null}
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                  {active?.locale ?? "No locale"}
                </div>
                <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                  Human edits protect individual display name and alt fields
                  from AI regeneration.
                </div>
              </div>
            </div>

            {active ? (
              <form
                key={active.id}
                action={saveLocale}
                className="grid content-start gap-4 p-4"
              >
                <input type="hidden" name="mediaAssetId" value={assetId} />
                <input type="hidden" name="locale" value={active.locale} />

                <label className="grid gap-1.5">
                  <span className="label-text">Display name</span>
                  <input
                    name="displayName"
                    defaultValue={active.displayName ?? ""}
                    disabled={!canEdit || isPending}
                    className="h-10 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 text-[13px] outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <FieldProvenance
                    locked={active.displayNameLocked}
                    source={active.displayNameSource}
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="label-text">Alt text</span>
                  <textarea
                    name="altText"
                    defaultValue={active.altText ?? ""}
                    disabled={!canEdit || isPending}
                    rows={5}
                    className="min-h-28 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 py-2 text-[13px] leading-6 outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <FieldProvenance
                    locked={active.altTextLocked}
                    source={active.altTextSource}
                  />
                </label>

                {active.errorMessage ? (
                  <div className="flex items-start gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3 text-[12px] text-[var(--color-text-muted)]">
                    <CircleAlert
                      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]"
                      strokeWidth={1.5}
                    />
                    {active.errorMessage}
                  </div>
                ) : null}

                {canEdit ? (
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={isPending}
                      className="inline-flex h-9 items-center gap-2 rounded-sm bg-[var(--color-brand)] px-3 text-[13px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Save className="h-4 w-4" strokeWidth={1.5} />
                      {isPending ? "Saving..." : "Save protected edit"}
                    </button>
                  </div>
                ) : null}
              </form>
            ) : (
              <div className="flex items-center justify-center p-8 text-[13px] text-[var(--color-text-muted)]">
                No image localizations have been created yet.
              </div>
            )}
          </section>
        </div>
      </div>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

function FieldProvenance({
  locked,
  source,
}: {
  locked: boolean
  source: MediaAssetLocaleRow["displayNameSource"]
}) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
      {locked ? (
        <UserRound className="h-3.5 w-3.5" strokeWidth={1.5} />
      ) : source === "AI" ? (
        <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
      ) : source ? (
        <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
      ) : (
        <CircleDashed className="h-3.5 w-3.5" strokeWidth={1.5} />
      )}
      {locked
        ? "Human-protected. AI retries will not overwrite this field."
        : source === "AI"
          ? "AI-generated. Editing will protect this field."
          : source
            ? `${source.toLowerCase()} value`
            : "Missing value"}
    </div>
  )
}
