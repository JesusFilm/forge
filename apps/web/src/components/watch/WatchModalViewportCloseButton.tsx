"use client"

import { X } from "lucide-react"
import { useTranslations } from "next-intl"
import type { Ref } from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

export const WATCH_MODAL_CLOSE_INSET_STYLE = {
  top: "max(1rem, env(safe-area-inset-top, 0px))",
  right: "max(1rem, env(safe-area-inset-right, 0px))",
} as const

export function WatchModalViewportCloseButton({
  open,
  onClose,
  testId,
  buttonRef,
  ariaLabel,
  portalContainer,
  renderInline = false,
  inFlowBelowSm = false,
}: {
  open: boolean
  onClose: () => void
  testId: string
  buttonRef?: Ref<HTMLButtonElement>
  ariaLabel?: string
  portalContainer?: HTMLElement | null
  /** Keep the button in its caller's DOM subtree so modal isolation does not hide it. */
  renderInline?: boolean
  /**
   * Below the `sm` breakpoint, take a row of the caller's layout (top right)
   * instead of floating over the viewport. A fixed button sits over the form
   * labels once a narrow dialog scrolls. Needs `renderInline`.
   */
  inFlowBelowSm?: boolean
}) {
  const t = useTranslations("WatchModal")
  if (!open || typeof document === "undefined") return null

  const button = (
    <button
      ref={buttonRef}
      type="button"
      aria-label={ariaLabel ?? t("close")}
      data-testid={testId}
      onClick={onClose}
      style={inFlowBelowSm ? undefined : WATCH_MODAL_CLOSE_INSET_STYLE}
      className={cn(
        "fixed z-[1100] flex h-[52px] w-12 cursor-pointer items-center justify-center rounded-full bg-transparent text-stone-300 transition hover:text-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50 focus-visible:outline-none",
        inFlowBelowSm &&
          "max-sm:relative max-sm:justify-self-end sm:top-[max(1rem,env(safe-area-inset-top,0px))] sm:right-[max(1rem,env(safe-area-inset-right,0px))]",
      )}
    >
      <X aria-hidden className="h-6 w-6" />
    </button>
  )

  return renderInline
    ? button
    : createPortal(button, portalContainer ?? document.body)
}
