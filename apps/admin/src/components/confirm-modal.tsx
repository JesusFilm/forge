"use client"

import { useEffect, type MouseEvent } from "react"
import { cx } from "@/components/admin-ui"

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  pending = false,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: "danger" | "default"
  pending?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        onCancel()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onCancel, open, pending])

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || pending) return
    onCancel()
  }

  return (
    <div
      className={cx(
        "fixed inset-0 z-50 flex items-center justify-center px-4 transition-all duration-180 ease-out sm:px-6",
        open
          ? "pointer-events-auto bg-[rgba(4,6,10,0.78)] backdrop-blur-[8px]"
          : "pointer-events-none bg-[rgba(4,6,10,0)] backdrop-blur-0",
      )}
      onClick={handleBackdropClick}
      role="presentation"
      aria-hidden={!open}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className={cx(
          "w-full max-w-[360px] rounded-sm border border-[var(--color-hairline-strong)] bg-[color-mix(in_oklab,var(--color-surface)_96%,black)] p-5 shadow-[0_32px_120px_rgba(0,0,0,0.58)] transition-all duration-180 ease-out",
          open
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-2 scale-[0.98] opacity-0",
        )}
      >
        <div className="space-y-2">
          <h2
            id="confirm-modal-title"
            className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]"
          >
            {title}
          </h2>
          <p className="text-[13px] leading-6 text-[var(--color-text-secondary)]">
            {description}
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] px-3 text-[13px] font-medium text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={cx(
              "inline-flex h-9 cursor-pointer items-center justify-center rounded-sm px-4 text-[13px] font-medium text-white transition-all duration-[120ms] ease-out disabled:cursor-not-allowed disabled:opacity-60",
              tone === "danger"
                ? "bg-[var(--color-danger)] hover:bg-[color-mix(in_oklab,var(--color-danger)_88%,black)]"
                : "bg-[var(--color-brand)] hover:bg-[var(--color-brand-pressed)]",
            )}
          >
            {pending ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
