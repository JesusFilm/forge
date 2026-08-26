"use client"

import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"

import { WatchModalViewportCloseButton } from "@/components/watch/WatchModalViewportCloseButton"

export type WatchIntroductionLoadingDialogProps = {
  failed: boolean
  onCancel: () => void
  onRetry?: () => void
  open: boolean
}

export function WatchIntroductionLoadingDialog({
  failed,
  onCancel,
  onRetry,
  open,
}: WatchIntroductionLoadingDialogProps) {
  const t = useTranslations("WatchIntroductionTour")
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const retryButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    ;(failed ? retryButtonRef.current : closeButtonRef.current)?.focus({
      preventScroll: true,
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== "Tab") return

      const focusable = [closeButtonRef.current, retryButtonRef.current].filter(
        (element): element is HTMLButtonElement => element != null,
      )
      if (focusable.length === 0) return
      const currentIndex = focusable.indexOf(
        document.activeElement as HTMLButtonElement,
      )
      const offset = event.shiftKey ? -1 : 1
      const nextIndex =
        (currentIndex + offset + focusable.length) % focusable.length
      event.preventDefault()
      focusable[nextIndex]?.focus({ preventScroll: true })
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [failed, onCancel, open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center overflow-hidden bg-black/82 p-4 backdrop-blur-[2px]"
      data-testid="watch-introduction-tour-loading"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="watch-introduction-loading-title"
        aria-describedby="watch-introduction-loading-description"
        className="relative z-[1070] grid w-[min(608px,calc(100vw-2rem))] gap-5 rounded-2xl border border-white/10 bg-stone-950 p-8 text-stone-100 shadow-[0_28px_90px_rgba(0,0,0,0.72)] ring-1 ring-white/10"
      >
        <WatchModalViewportCloseButton
          open
          onClose={onCancel}
          testId="watch-introduction-loading-close"
          buttonRef={closeButtonRef}
          ariaLabel={t("close")}
          renderInline
        />
        <h2
          id="watch-introduction-loading-title"
          className="pe-12 text-2xl font-bold text-white"
        >
          {t("steps.discover.title")}
        </h2>
        <p
          id="watch-introduction-loading-description"
          role="status"
          aria-live="polite"
          className="text-base text-stone-300"
        >
          {failed ? t("loadFailed") : t("loading")}
        </p>
        {failed && onRetry ? (
          <button
            ref={retryButtonRef}
            type="button"
            onClick={onRetry}
            className="min-h-11 justify-self-start rounded-full bg-white px-6 py-3 text-sm font-bold text-stone-950 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950 focus-visible:outline-none"
          >
            {t("retry")}
          </button>
        ) : null}
      </div>
    </div>
  )
}
