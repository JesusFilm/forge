import {
  BookOpen,
  HelpCircle,
  LayoutGrid,
  Play,
  Sparkles,
  Type,
  Video,
} from "lucide-react"

import type { SectionBlock } from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"

import { SectionRenderer } from "./SectionRenderer"

type SectionCardProps = {
  block: SectionBlock
  index: number
}

type SectionMeta = {
  label: string
  icon: React.ReactNode
}

function getSectionMeta(block: SectionBlock): SectionMeta {
  switch (block.__component) {
    case "sections.video":
      return { label: "Video", icon: <Video className="h-3.5 w-3.5" /> }
    case "sections.video-hero":
      return { label: "Video Hero", icon: <Play className="h-3.5 w-3.5" /> }
    case "sections.video-carousel":
      return {
        label: "Video Carousel",
        icon: <Video className="h-3.5 w-3.5" />,
      }
    case "sections.text":
      return { label: "Text", icon: <Type className="h-3.5 w-3.5" /> }
    case "sections.bible-quotes-carousel":
      return {
        label: "Bible Quotes",
        icon: <BookOpen className="h-3.5 w-3.5" />,
      }
    case "sections.related-questions":
      return {
        label: "Related Questions",
        icon: <HelpCircle className="h-3.5 w-3.5" />,
      }
    case "sections.quiz-button":
      return {
        label: "Quiz Button",
        icon: <Sparkles className="h-3.5 w-3.5" />,
      }
    case "sections.container":
      return {
        label: "Container",
        icon: <LayoutGrid className="h-3.5 w-3.5" />,
      }
    default:
      return { label: "Section", icon: <LayoutGrid className="h-3.5 w-3.5" /> }
  }
}

export function SectionCard({ block, index }: SectionCardProps) {
  const meta = getSectionMeta(block)

  return (
    <div
      className={cn(
        "rounded-xl border border-neutral-200 bg-white p-4 shadow-sm",
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <span
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded",
            "bg-primary-50 text-primary-600",
          )}
        >
          {meta.icon}
        </span>
        <span className="text-xs font-medium text-neutral-500">
          {index + 1}. {meta.label}
        </span>
      </div>
      <SectionRenderer block={block} />
    </div>
  )
}
