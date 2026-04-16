"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { X } from "lucide-react"
import { cx } from "@/components/admin-ui"

export type ToastTone = "success" | "error"
type ToastState = "entering" | "visible" | "exiting"
const TOAST_AUTO_DISMISS_MS = 3600

export type ToastEntry = {
  id: string
  message: string
  tone: ToastTone
  state: ToastState
}

export function useToastStack() {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const autoDismissTimers = useRef(new Map<string, number>())
  const removalTimers = useRef(new Map<string, number>())

  function dismissToast(id: string) {
    setToasts((current) =>
      current.map((toast) =>
        toast.id === id ? { ...toast, state: "exiting" } : toast,
      ),
    )
  }

  useEffect(() => {
    toasts.forEach((toast) => {
      if (
        toast.tone === "success" &&
        toast.state !== "exiting" &&
        !autoDismissTimers.current.has(toast.id)
      ) {
        const timeoutId = window.setTimeout(() => {
          dismissToast(toast.id)
        }, TOAST_AUTO_DISMISS_MS)
        autoDismissTimers.current.set(toast.id, timeoutId)
      }

      if (toast.state === "exiting" && !removalTimers.current.has(toast.id)) {
        const timeoutId = window.setTimeout(() => {
          setToasts((current) =>
            current.filter((entry) => entry.id !== toast.id),
          )
        }, 220)
        removalTimers.current.set(toast.id, timeoutId)
      }
    })

    autoDismissTimers.current.forEach((timeoutId, id) => {
      const toast = toasts.find((entry) => entry.id === id)
      if (!toast || toast.state === "exiting") {
        window.clearTimeout(timeoutId)
        autoDismissTimers.current.delete(id)
      }
    })

    removalTimers.current.forEach((timeoutId, id) => {
      const toast = toasts.find((entry) => entry.id === id)
      if (!toast) {
        window.clearTimeout(timeoutId)
        removalTimers.current.delete(id)
      }
    })
  }, [toasts])

  useEffect(() => {
    const autoTimers = autoDismissTimers.current
    const exitTimers = removalTimers.current

    return () => {
      autoTimers.forEach((timeoutId) => window.clearTimeout(timeoutId))
      exitTimers.forEach((timeoutId) => window.clearTimeout(timeoutId))
    }
  }, [])

  function pushToast(message: string, tone: ToastTone) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setToasts((current) => {
      let next = [{ id, message, tone, state: "entering" as const }, ...current]
      const active = next.filter((toast) => toast.state !== "exiting")

      if (active.length > 5) {
        const oldestActiveId = [...active].reverse()[0]?.id
        next = next.map((toast) =>
          toast.id === oldestActiveId ? { ...toast, state: "exiting" } : toast,
        )
      }

      return next
    })

    window.requestAnimationFrame(() => {
      setToasts((current) =>
        current.map((toast) =>
          toast.id === id && toast.state === "entering"
            ? { ...toast, state: "visible" }
            : toast,
        ),
      )
    })
  }
  return {
    toasts,
    pushToast,
    dismissToast,
  }
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastEntry[]
  onDismiss: (id: string) => void
}) {
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(300px,calc(100vw-2rem))] flex-col"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cx(
            "pointer-events-none overflow-hidden transition-[max-height,margin-bottom,opacity] duration-[220ms] ease-out",
            toast.state === "visible"
              ? "mb-2 max-h-40 opacity-100 last:mb-0"
              : "mb-0 max-h-0 opacity-0",
          )}
        >
          <div
            className={cx(
              "pointer-events-auto relative overflow-hidden rounded-sm border px-3 py-3 shadow-[0_20px_48px_rgba(0,0,0,0.42)] backdrop-blur-[10px] transition-all duration-[220ms] ease-out",
              toast.state === "visible"
                ? "translate-x-0 opacity-100"
                : "translate-x-8 opacity-0",
              toast.tone === "error"
                ? "border-[var(--color-danger-border)] bg-[color-mix(in_oklab,var(--color-danger)_18%,var(--color-surface))] text-[var(--color-danger)]"
                : "border-[var(--color-success-border)] bg-[color-mix(in_oklab,var(--color-success)_14%,var(--color-surface))] text-[var(--color-text-primary)]",
            )}
          >
            {toast.tone === "success" ? (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-left animate-[toast-progress_linear_forwards] bg-[color-mix(in_oklab,var(--color-success)_55%,transparent)]"
                style={
                  {
                    animationDuration: `${TOAST_AUTO_DISMISS_MS}ms`,
                  } satisfies CSSProperties
                }
              />
            ) : null}
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1 text-[13px] leading-5">
                {toast.message}
              </div>
              {toast.tone === "error" ? (
                <button
                  type="button"
                  onClick={() => onDismiss(toast.id)}
                  className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:bg-black/10 hover:text-[var(--color-text-primary)]"
                  aria-label="Dismiss notification"
                >
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
