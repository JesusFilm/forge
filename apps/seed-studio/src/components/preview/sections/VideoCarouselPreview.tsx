import { Play } from "lucide-react"

import type { VideoCarouselSection } from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"
import { fixImageUrl, getMuxThumbnail } from "@/lib/mux"

type VideoCarouselPreviewProps = {
  section: VideoCarouselSection
}

export function VideoCarouselPreview({ section }: VideoCarouselPreviewProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-neutral-900">
          {section.title}
        </h4>
        {section.subtitle ? (
          <p className="text-xs text-neutral-500">{section.subtitle}</p>
        ) : null}
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {(section.items ?? []).map((item) => (
          <div key={item.sectionKey} className="w-36 shrink-0 space-y-2">
            <div
              className={cn(
                "relative flex aspect-video items-center justify-center",
                "rounded-lg bg-neutral-200",
              )}
            >
              {(fixImageUrl(item.videoRef?.thumbnailUrl) ??
              getMuxThumbnail(item.streamingUrl)) ? (
                <img
                  src={
                    (fixImageUrl(item.videoRef?.thumbnailUrl) ??
                      getMuxThumbnail(item.streamingUrl))!
                  }
                  alt={item.title}
                  className="h-full w-full rounded-lg object-cover"
                />
              ) : null}
              <div
                className={cn(
                  "absolute flex h-8 w-8 items-center justify-center",
                  "rounded-full bg-white/90 shadow-sm",
                )}
              >
                <Play className="ml-0.5 h-3 w-3 text-neutral-700" />
              </div>
            </div>
            <p className="truncate text-xs font-medium text-neutral-800">
              {item.title}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
