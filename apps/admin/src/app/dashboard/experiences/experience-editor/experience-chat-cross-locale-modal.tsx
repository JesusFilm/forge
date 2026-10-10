"use client"

import { AlertTriangle, X } from "lucide-react"
import { createPortal } from "react-dom"

export function ExperienceChatCrossLocaleModal({
  open,
  affectedLocales,
  onCancel,
  onConfirm,
}: {
  open: boolean
  affectedLocales: string[]
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!open || typeof document === "undefined") return null

  // Portal at <body>: this modal renders inside the chat panel's `sticky`,
  // `overflow-hidden` <aside>, which traps + clips a `fixed inset-0` overlay
  // to the chat column. Same root cause + fix as AnchorVideoPicker.
  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cross-locale-modal-title"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-sm border border-[var(--color-hairline-strong)] bg-[var(--color-surface)] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[color:color-mix(in_oklab,var(--color-warning)_30%,var(--color-hairline))] bg-[color:color-mix(in_oklab,var(--color-warning)_14%,var(--color-surface-inset))] text-[var(--color-warning)]">
              <AlertTriangle className="h-4 w-4" strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                Cross-locale change
              </div>
              <h2
                id="cross-locale-modal-title"
                className="mt-2 text-[16px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]"
              >
                Apply this change to multiple locales?
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
            aria-label="Close cross-locale confirmation"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <p className="mt-4 text-[13px] leading-6 text-[var(--color-text-secondary)]">
          The AI will write to the following locale
          {affectedLocales.length === 1 ? "" : "s"}:
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {affectedLocales.map((locale) => (
            <li
              key={locale}
              className="inline-flex items-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-secondary)]"
            >
              {locale}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] leading-5 text-[var(--color-text-muted)]">
          Cross-locale writes are gated for safety. Cancel to keep changes
          scoped to the active locale, or confirm to allow the AI to write
          across all listed locales.
        </p>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center justify-center rounded-sm border border-[var(--color-hairline)] px-3 text-[12px] font-medium text-[var(--color-text-secondary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex h-9 items-center justify-center rounded-sm bg-[var(--color-brand)] px-3 text-[12px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)]"
          >
            Apply across locales
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}
