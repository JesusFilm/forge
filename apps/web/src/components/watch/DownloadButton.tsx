"use client"

import type { MouseEvent } from "react"
import { Download } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button, buttonVariants } from "@/components/ui/button"
import { WATCH_PILL_BUTTON_CLASS } from "@/components/watch/watch-section-styles"
import { cn } from "@/lib/utils"

export function DownloadButton({
  href,
  label,
  onClick,
  pending = false,
}: {
  href?: string
  // Optional override from the LaunchDarkly `forge.watch.ctaTextCopy`
  // smoke flag (e.g. "Save Video"). When absent, fall back to the
  // i18n'd default copy. Mirrors the LanguageCombobox `placeholder ??
  // t(...)` pattern.
  label?: string
  onClick: () => void
  pending?: boolean
}) {
  const t = useTranslations("DownloadButton")
  const resolvedLabel = label ?? t("download")
  const className = cn(
    buttonVariants({ variant: "pill", className: WATCH_PILL_BUTTON_CLASS }),
    pending ? "pointer-events-none opacity-50" : "",
  )

  function handleAnchorClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    if (pending) return
    onClick()
  }

  if (href) {
    return (
      <a
        href={href}
        download
        data-slot="button"
        className={className}
        aria-label={resolvedLabel}
        aria-busy={pending}
        aria-disabled={pending ? "true" : undefined}
        data-testid="watch-download-button"
        tabIndex={pending ? -1 : undefined}
        onClick={handleAnchorClick}
      >
        <Download aria-hidden="true" size={18} />
        <span>{pending ? t("checking") : resolvedLabel}</span>
      </a>
    )
  }

  return (
    <Button
      variant="pill"
      className={WATCH_PILL_BUTTON_CLASS}
      aria-label={resolvedLabel}
      aria-busy={pending}
      data-testid="watch-download-button"
      disabled={pending}
      onClick={onClick}
    >
      <Download aria-hidden="true" size={18} />
      <span>{pending ? t("checking") : resolvedLabel}</span>
    </Button>
  )
}
