"use client"

import { Download } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { WATCH_PILL_BUTTON_CLASS } from "@/components/watch/watch-section-styles"

export function DownloadButton({
  label,
  onClick,
  pending = false,
}: {
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
