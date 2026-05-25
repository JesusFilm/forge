import type { AdminBlock } from "../../lib/queries"
import { VideoHeroRenderer } from "./VideoHeroRenderer"
import { SectionWrapperRenderer } from "./SectionWrapperRenderer"
import { VideoCardRenderer } from "./VideoCardRenderer"
import { NavigationCarouselRenderer } from "./NavigationCarouselRenderer"
import { VideoCarouselRenderer } from "./VideoCarouselRenderer"
import { MediaCollectionRenderer } from "./MediaCollectionRenderer"
import { TextRenderer } from "./TextRenderer"
import { RelatedQuestionsRenderer } from "./RelatedQuestionsRenderer"
import { BibleQuotesCarouselRenderer } from "./BibleQuotesCarouselRenderer"
import { QuizButtonRenderer } from "./QuizButtonRenderer"
import { EasterDatesRenderer } from "./EasterDatesRenderer"
import { ContainerRenderer } from "./ContainerRenderer"

export function classifySection(block: AdminBlock): "videoCard" | "standard" {
  if (
    block.__typename === "SectionBlock" &&
    "sectionContent" in block &&
    Array.isArray(block.sectionContent)
  ) {
    const children = block.sectionContent as AdminBlock[]
    const firstVideo = children.find((c) => c.__typename === "VideoBlock")
    if (firstVideo) return "videoCard"
  }
  if (block.__typename === "VideoBlock") return "videoCard"
  return "standard"
}

export interface SectionDispatcherProps {
  section: AdminBlock
  asVideoCard?: boolean
}

export function SectionDispatcher({
  section,
  asVideoCard,
}: SectionDispatcherProps) {
  const typename = section.__typename

  if (
    asVideoCard &&
    (typename === "SectionBlock" || typename === "VideoBlock")
  ) {
    const videoBlock =
      typename === "VideoBlock"
        ? section
        : (("sectionContent" in section && Array.isArray(section.sectionContent)
            ? (section.sectionContent as AdminBlock[]).find(
                (c) => c.__typename === "VideoBlock",
              )
            : null) ?? null)
    if (videoBlock) {
      return <VideoCardRenderer section={videoBlock} />
    }
  }

  switch (typename) {
    case "VideoHeroBlock":
      return <VideoHeroRenderer section={section} />
    case "SectionBlock":
      return <SectionWrapperRenderer section={section} />
    case "VideoBlock":
      return <VideoCardRenderer section={section} />
    case "NavigationCarouselBlock":
      return <NavigationCarouselRenderer section={section} />
    case "VideoCarouselBlock":
      return <VideoCarouselRenderer section={section} />
    case "MediaCollectionBlock":
      return <MediaCollectionRenderer section={section} />
    case "TextBlock":
      return <TextRenderer section={section} />
    case "RelatedQuestionsBlock":
      return <RelatedQuestionsRenderer section={section} />
    case "BibleQuotesCarouselBlock":
      return <BibleQuotesCarouselRenderer section={section} />
    case "QuizButtonBlock":
      return <QuizButtonRenderer section={section} />
    case "EasterDatesBlock":
      return <EasterDatesRenderer section={section} />
    case "ContainerBlock":
      return <ContainerRenderer section={section} />
    case "AdventCountdownBlock":
    case "CtaBlock":
      return null
    default:
      if (__DEV__) {
        console.warn(`[SectionDispatcher] Unhandled block type: ${typename}`)
      }
      return null
  }
}
