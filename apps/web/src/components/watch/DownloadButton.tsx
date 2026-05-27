"use client"

import { Download } from "lucide-react"

import { Button } from "@/components/ui/button"
import { WATCH_PILL_BUTTON_CLASS } from "@/components/watch/watch-section-styles"

export function DownloadButton({
  onClick,
  pending = false,
}: {
  onClick: () => void
  pending?: boolean
}) {
  return (
    <Button
      variant="pill"
      className={WATCH_PILL_BUTTON_CLASS}
      aria-label="Download"
      aria-busy={pending}
      data-testid="watch-download-button"
      disabled={pending}
      onClick={onClick}
    >
      <Download aria-hidden="true" size={18} />
      <span>{pending ? "Checking" : "Download"}</span>
    </Button>
  )
}
