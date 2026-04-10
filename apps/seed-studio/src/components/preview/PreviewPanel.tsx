"use client"

import { useMemo, useState } from "react"
import { LayoutTemplate } from "lucide-react"

import type {
  GeneratedExperience,
  Platform,
  SectionBlock,
} from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"

import { PlatformToggle } from "./PlatformToggle"
import { SectionCard } from "./SectionCard"

type PreviewPanelProps = {
  experience: GeneratedExperience | null
}

export function PreviewPanel({ experience }: PreviewPanelProps) {
  const [platform, setPlatform] = useState<Platform>("web")

  const orderedBlocks = useMemo<SectionBlock[]>(() => {
    if (!experience) return []
    const ordering = experience.platformOrdering[platform]
    if (!ordering || ordering.length === 0) return experience.blocks
    return ordering
      .filter((idx) => idx >= 0 && idx < experience.blocks.length)
      .map((idx) => experience.blocks[idx])
  }, [experience, platform])

  if (!experience) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <div
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-2xl",
            "bg-neutral-100",
          )}
        >
          <LayoutTemplate className="h-7 w-7 text-neutral-400" />
        </div>
        <p className="text-center text-sm text-neutral-500">
          Your experience preview will appear here
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "flex items-center justify-between border-b border-neutral-200",
          "bg-white px-4 py-3",
        )}
      >
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-neutral-900">
            {experience.title}
          </h2>
          {experience.metaDescription ? (
            <p className="truncate text-xs text-neutral-500">
              {experience.metaDescription}
            </p>
          ) : null}
        </div>
        <PlatformToggle platform={platform} onChange={setPlatform} />
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {orderedBlocks.map((block, i) => (
          <SectionCard key={i} block={block} index={i} />
        ))}
      </div>
    </div>
  )
}
