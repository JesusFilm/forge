import { Play } from "lucide-react"

import type { VideoHeroSection } from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"
import { getMuxThumbnail } from "@/lib/mux"

type VideoHeroPreviewProps = {
  section: VideoHeroSection
}

export function VideoHeroPreview({ section }: VideoHeroPreviewProps) {
  const thumbnail =
    section.videoRef?.thumbnailUrl ?? getMuxThumbnail(section.streamingUrl)

  return (
    <div
      className={cn(
        "relative flex aspect-[16/7] items-end overflow-hidden",
        "rounded-lg bg-neutral-800",
      )}
    >
      {thumbnail ? (
        <img
          src={thumbnail}
          alt={section.heading}
          className="absolute inset-0 h-full w-full object-cover opacity-60"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
      <div className="relative z-10 space-y-3 p-5">
        <h3 className="text-lg font-bold text-white">{section.heading}</h3>
        <div className="flex items-center gap-3">
          {section.ctaLabel ? (
            <button
              type="button"
              className={cn(
                "rounded-lg bg-primary-500 px-4 py-2",
                "text-sm font-medium text-white",
              )}
            >
              {section.ctaLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={cn(
              "flex h-9 w-9 items-center justify-center",
              "rounded-full bg-white/20 backdrop-blur-sm",
            )}
          >
            <Play className="ml-0.5 h-4 w-4 text-white" />
          </button>
        </div>
      </div>
    </div>
  )
}
