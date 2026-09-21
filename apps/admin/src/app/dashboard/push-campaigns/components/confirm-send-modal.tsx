"use client"

/**
 * KTD10 — the one confirmation shape send now and cancel both use.
 *
 * `requiredValue` is what makes send now different: the editor has to type the
 * resolved audience count, so a mistyped number cannot reach the whole world.
 */
import { useEffect, useId, useRef, useState, type MouseEvent } from "react"

import { cx } from "@/components/admin-ui"

type ConfirmSendModalProps = {
  title: string
  consequence: string
  detail?: string
  requiredValue?: string
  requiredLabel?: string
  confirmLabel: string
  pending?: boolean
  onCancel: () => void
  onConfirm: (typed: string) => void
  testId?: string
}

/**
 * Closing unmounts the dialog, so a reopened confirmation always starts with
 * an empty field rather than the number the editor typed last time.
 */
export function ConfirmSendModal({
  open,
  ...props
}: ConfirmSendModalProps & { open: boolean }) {
  if (!open) return null
  return <ConfirmSendDialog {...props} />
}

function ConfirmSendDialog({
  title,
  consequence,
  detail,
  requiredValue,
  requiredLabel,
  confirmLabel,
  pending = false,
  onCancel,
  onConfirm,
  testId,
}: ConfirmSendModalProps) {
  const [typed, setTyped] = useState("")
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    // Focus the field the editor has to fill, or the button when there is none.
    if (requiredValue) inputRef.current?.focus()
    else confirmRef.current?.focus()
  }, [requiredValue])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onCancel()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [pending, onCancel])

  const satisfied = requiredValue == null || typed.trim() === requiredValue

  function onBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || pending) return
    onCancel()
  }

  return (
    <div
      role="presentation"
      data-testid={testId}
      onClick={onBackdropClick}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(4,6,10,0.78)] px-4 backdrop-blur-[8px] sm:px-6"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${inputId}-title`}
        className="w-full max-w-[420px] rounded-sm border border-[var(--color-hairline-strong)] bg-[color-mix(in_oklab,var(--color-surface)_96%,black)] p-5 shadow-[0_32px_120px_rgba(0,0,0,0.58)]"
      >
        <h2
          id={`${inputId}-title`}
          className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]"
        >
          {title}
        </h2>
        <p className="mt-2 text-[13px] leading-6 text-[var(--color-text-secondary)]">
          {consequence}
        </p>
        {detail ? (
          <p className="mt-2 break-words text-[12px] leading-5 text-[var(--color-text-muted)]">
            {detail}
          </p>
        ) : null}

        {requiredValue ? (
          <label className="mt-4 grid gap-1.5" htmlFor={inputId}>
            <span className="text-[12px] text-[var(--color-text-secondary)]">
              {requiredLabel ?? `Type ${requiredValue} to confirm`}
            </span>
            <input
              ref={inputRef}
              id={inputId}
              name="confirmValue"
              inputMode="numeric"
              autoComplete="off"
              data-testid="push-confirm-input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              className="h-9 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[13px] text-[var(--color-text-primary)] outline-none focus-visible:border-[var(--color-brand)]"
            />
          </label>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] px-3 text-[13px] font-medium text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Keep editing
          </button>
          <button
            ref={confirmRef}
            type="button"
            data-testid="push-confirm-submit"
            onClick={() => onConfirm(typed.trim())}
            disabled={pending || !satisfied}
            className={cx(
              "inline-flex h-9 cursor-pointer items-center justify-center rounded-sm px-4 text-[13px] font-medium text-white transition-all duration-[120ms] ease-out",
              "bg-[var(--color-danger)] hover:bg-[color-mix(in_oklab,var(--color-danger)_88%,black)]",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {pending ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
