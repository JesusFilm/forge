"use client"

import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { WATCH_PILL_BUTTON_CLASS } from "@/components/watch/watch-section-styles"

export function DownloadButton({
  label,
  onClick,
}: {
  // Optional override from the LaunchDarkly `forge.watch.ctaTextCopy`
  // smoke flag (e.g. "Save Video"). When absent, fall back to the
  // i18n'd default copy. Mirrors the LanguageCombobox `placeholder ??
  // t(...)` pattern.
  label?: string
  onClick: () => void
}) {
  const t = useTranslations("DownloadButton")
  const resolvedLabel = label ?? t("download")
  return (
    <Button
      variant="pill"
      className={WATCH_PILL_BUTTON_CLASS}
      aria-label={resolvedLabel}
      data-testid="watch-download-button"
      onClick={onClick}
    >
      <DownloadIcon />
      <span>{resolvedLabel}</span>
    </Button>
  )
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}
