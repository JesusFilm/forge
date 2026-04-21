import type { NormalizedBlock } from "../../lib/normalizer"
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

/**
 * Classify a section for the home feed.
 * A sectionWrapper whose first child is a "video" block renders as a videoCard.
 */
export function classifySection(
  block: NormalizedBlock,
): "videoCard" | "standard" {
  if (block.kind === "sectionWrapper" && Array.isArray(block.sectionContent)) {
    const children = block.sectionContent as NormalizedBlock[]
    const firstVideo = children.find((c) => c.kind === "video")
    if (firstVideo) return "videoCard"
  }
  if (block.kind === "video") return "videoCard"
  return "standard"
}

export interface SectionDispatcherProps {
  section: NormalizedBlock
  /** When true, render sectionWrapper-with-video as a VideoCard */
  asVideoCard?: boolean
}

export function SectionDispatcher({
  section,
  asVideoCard,
}: SectionDispatcherProps) {
  const { kind } = section

  // If classified as a videoCard on home, render the VideoCardRenderer
  if (asVideoCard && (kind === "sectionWrapper" || kind === "video")) {
    const videoBlock =
      kind === "video"
        ? section
        : ((section.sectionContent as NormalizedBlock[])?.find(
            (c) => c.kind === "video",
          ) ?? null)
    if (videoBlock) {
      return <VideoCardRenderer section={videoBlock} />
    }
  }

  switch (kind) {
    case "videoHero":
      return <VideoHeroRenderer section={section} />
    case "sectionWrapper":
      return <SectionWrapperRenderer section={section} />
    case "video":
      return <VideoCardRenderer section={section} />
    case "navigationCarousel":
      return <NavigationCarouselRenderer section={section} />
    case "videoCarousel":
      return <VideoCarouselRenderer section={section} />
    case "mediaCollection":
      return <MediaCollectionRenderer section={section} />
    case "text":
      return <TextRenderer section={section} />
    case "relatedQuestions":
      return <RelatedQuestionsRenderer section={section} />
    case "bibleQuotesCarousel":
      return <BibleQuotesCarouselRenderer section={section} />
    case "quizButton":
      return <QuizButtonRenderer section={section} />
    case "easterDates":
      return <EasterDatesRenderer section={section} />
    case "container":
      return <ContainerRenderer section={section} />
    case "adventCountdown":
    case "cta":
      // TODO: implement dedicated renderers
      return null
    default:
      if (__DEV__) {
        console.warn(`[SectionDispatcher] Unhandled section kind: ${kind}`)
      }
      return null
  }
}
