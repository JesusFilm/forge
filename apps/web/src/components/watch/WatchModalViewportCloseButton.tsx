"use client"

import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"

export function WatchModalViewportCloseButton({
  open,
  onClose,
  testId,
  portalContainer,
  positionClassName = "top-12 right-10",
  className,
}: {
  open: boolean
  onClose: () => void
  testId: string
  portalContainer?: HTMLElement | null
  positionClassName?: string
  className?: string
}) {
  const t = useTranslations("WatchModal")
  if (!open || typeof document === "undefined") return null

  return createPortal(
    <button
      type="button"
      aria-label={t("close")}
      data-testid={testId}
      onClick={onClose}
      className={cn(
        "fixed z-[60] flex h-[52px] w-12 cursor-pointer items-center justify-center rounded-full bg-transparent text-stone-300 transition hover:text-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50 focus-visible:outline-none",
        positionClassName,
        className,
      )}
    >
      <X aria-hidden className="h-6 w-6" />
    </button>,
    portalContainer ?? document.body,
  )
}
