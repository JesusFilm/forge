"use client"

import {
  getWatchProgressRatio,
  useWatchProgress,
} from "@/lib/watch-progress-client"
import { cn } from "@/lib/utils"

export function WatchProgressBar({
  videoId,
  className,
}: {
  videoId: string | null | undefined
  className?: string
}) {
  const progress = useWatchProgress(videoId)
  const ratio = getWatchProgressRatio(progress)
  if (ratio <= 0) return null

  return (
    <div
      aria-hidden="true"
      data-testid="watch-progress-bar"
      className={cn(
        "pointer-events-none absolute right-2 bottom-2 left-2 z-[70] h-1.5 overflow-hidden rounded-full bg-black/55 shadow-[0_1px_6px_rgba(0,0,0,0.55)]",
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-brand-red shadow-[0_0_10px_rgba(239,68,68,0.75)]"
        style={{ width: `${Math.round(ratio * 100)}%` }}
      />
    </div>
  )
}
