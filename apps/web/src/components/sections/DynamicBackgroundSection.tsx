"use client"

import { useState } from "react"
import type { FragmentOf } from "@forge/graphql"
import { cn } from "@/lib/utils"
import { CONTENT_WIDTH_ALIGN_CLASSES } from "@/lib/content-width"
import type { containerFragment } from "@/lib/fragments/container"
import type { mediaCollectionFragment } from "@/lib/fragments/media-collection"
import type { relatedQuestionsFragment } from "@/lib/fragments/related-questions"
import type { videoSectionFragment } from "@/lib/fragments/video-section"
import type { bibleQuotesCarouselFragment } from "@/lib/fragments/bible-quotes-carousel"
import { BibleQuotesCarousel } from "./BibleQuotesCarousel"
import { Container } from "./Container"
import { MediaCollection } from "./MediaCollection"
import { Video } from "./Video"
import { RelatedQuestions } from "./RelatedQuestions"

const BASE_PATH = "/watch"

const DYNAMIC_BG_CLASSES: Record<string, string> = {
  default: "bg-stone-900",
  light: "bg-stone-100",
  dark: "bg-linear-to-tr from-blue-950/10 via-purple-950/10 to-[#91214A]/90",
  primary: "bg-blue-900",
}

type ContentItem = {
  __typename?: string
  [key: string]: unknown
}

type DynamicBackgroundSectionProps = {
  id: string | null
  sectionKey: string | null
  backgroundColor: string | null
  content: ContentItem[]
}

export function DynamicBackgroundSection({
  id,
  sectionKey,
  backgroundColor,
  content,
}: DynamicBackgroundSectionProps) {
  const [activeImage, setActiveImage] = useState<string | null>(null)

  const bgClass =
    DYNAMIC_BG_CLASSES[backgroundColor ?? "default"] ??
    DYNAMIC_BG_CLASSES.default

  return (
    <section
      id={id ?? undefined}
      data-section-key={sectionKey ?? undefined}
      data-testid="Section"
      className="relative w-full"
    >
      <div
        className={cn(
          `relative ${CONTENT_WIDTH_ALIGN_CLASSES} overflow-hidden py-16 backdrop-blur-md`,
          bgClass,
        )}
      >
        <div
          className={cn(
            "absolute inset-0 z-0 bg-cover bg-center bg-no-repeat mix-blend-overlay blur-lg transition-opacity duration-500 ease-in-out",
            activeImage ? "opacity-30" : "opacity-0",
          )}
          aria-hidden="true"
          style={
            activeImage
              ? { backgroundImage: `url("${BASE_PATH}${activeImage}")` }
              : undefined
          }
        />

        <div
          className="absolute inset-0 z-1 bg-repeat mix-blend-multiply"
          style={{
            backgroundImage: `url("${BASE_PATH}/assets/overlay.svg")`,
          }}
          aria-hidden="true"
        />

        <div className="relative z-2">
          {content.map((item, index) => {
            if (!item || item.__typename === "Error") return null
            const typename = item.__typename as string
            return (
              <DynamicContentRenderer
                key={`section-${id ?? index}-${index}`}
                item={item}
                typename={typename}
                onBackgroundImageChange={setActiveImage}
              />
            )
          })}
        </div>
      </div>
    </section>
  )
}

function DynamicContentRenderer({
  item,
  typename,
  onBackgroundImageChange,
}: {
  item: ContentItem
  typename: string
  onBackgroundImageChange: (url: string | null) => void
}) {
  switch (typename) {
    case "ComponentSectionsContainer":
      return (
        <Container
          data={item as unknown as FragmentOf<typeof containerFragment>}
        />
      )
    case "ComponentSectionsVideo":
      return (
        <Video
          data={item as unknown as FragmentOf<typeof videoSectionFragment>}
        />
      )
    case "ComponentSectionsRelatedQuestions":
      return (
        <RelatedQuestions
          data={item as unknown as FragmentOf<typeof relatedQuestionsFragment>}
        />
      )
    case "ComponentSectionsBibleQuotesCarousel":
      return (
        <BibleQuotesCarousel
          data={
            item as unknown as FragmentOf<typeof bibleQuotesCarouselFragment>
          }
        />
      )
    case "ComponentSectionsMediaCollection":
      return (
        <MediaCollection
          data={item as unknown as FragmentOf<typeof mediaCollectionFragment>}
          onBackgroundImageChange={onBackgroundImageChange}
        />
      )
    default:
      return null
  }
}
