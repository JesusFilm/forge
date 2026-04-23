"use client"

import { useState } from "react"
import { Play } from "lucide-react"

import type { VideoSection } from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"
import { fixImageUrl, getMuxThumbnail } from "@/lib/mux"
import { VideoPlayer } from "../VideoPlayer"

type VideoSectionPreviewProps = {
  section: VideoSection
}

export function VideoSectionPreview({ section }: VideoSectionPreviewProps) {
  const [playing, setPlaying] = useState(false)
  const streamingUrl = section.streamingUrl ?? section.videoRef?.streamingUrl
  const thumbnail =
    fixImageUrl(section.videoRef?.thumbnailUrl) ?? getMuxThumbnail(streamingUrl)

  return (
    <div className="space-y-3">
      {playing && streamingUrl ? (
        <VideoPlayer
          src={streamingUrl}
          poster={thumbnail ?? undefined}
          playOnMount
          onClose={() => setPlaying(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className={cn(
            "relative flex w-full aspect-video items-center justify-center",
            "rounded-lg bg-neutral-200 cursor-pointer",
          )}
        >
          {thumbnail ? (
            <img
              src={thumbnail}
              alt={section.title}
              className="h-full w-full rounded-lg object-cover"
            />
          ) : null}
          <div
            className={cn(
              "absolute flex h-12 w-12 items-center justify-center",
              "rounded-full bg-white/90 shadow-md transition hover:scale-110",
            )}
          >
            <Play className="ml-0.5 h-5 w-5 text-neutral-700" />
          </div>
        </button>
      )}
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
