import { Play } from "lucide-react"

import type { VideoSection } from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"

type VideoSectionPreviewProps = {
  section: VideoSection
}

export function VideoSectionPreview({ section }: VideoSectionPreviewProps) {
  return (
    <div className="space-y-3">
      <div
        className={cn(
          "relative flex aspect-video items-center justify-center",
          "rounded-lg bg-neutral-200",
        )}
      >
        {section.videoRef?.thumbnailUrl ? (
          <img
            src={section.videoRef.thumbnailUrl}
            alt={section.title}
            className="h-full w-full rounded-lg object-cover"
          />
        ) : null}
        <div
          className={cn(
            "absolute flex h-12 w-12 items-center justify-center",
            "rounded-full bg-white/90 shadow-md",
          )}
        >
          <Play className="ml-0.5 h-5 w-5 text-neutral-700" />
        </div>
      </div>
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-neutral-900">
          {section.title}
        </h4>
        {section.subtitle ? (
          <p className="text-sm text-neutral-500">{section.subtitle}</p>
        ) : null}
      </div>
    </div>
  )
}
