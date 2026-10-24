"use client"

import { MessageSquareHeart } from "lucide-react"

import { requestWatchFeedback } from "@/lib/watch-feedback-events"

/**
 * Opens the global Watch feedback composer owned by `FeedbackLauncher`.
 * The launcher is a sibling of the page tree, so this dispatches the
 * shared window event rather than mounting a second modal.
 */
export function WhatsNewFeedbackButton({
  label,
  className,
}: {
  label: string
  className: string
}) {
  return (
    <button type="button" onClick={requestWatchFeedback} className={className}>
      <MessageSquareHeart aria-hidden className="size-4 shrink-0" />
      {label}
    </button>
  )
}
