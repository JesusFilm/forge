import type { NormalizedBlock } from "../../lib/normalizer"
import { SectionWrapperRenderer } from "./SectionWrapperRenderer"
import { ContainerRenderer } from "./ContainerRenderer"
import { VideoHeroRenderer } from "./VideoHeroRenderer"
import { VideoCardRenderer } from "./VideoCardRenderer"
import { TextRenderer } from "./TextRenderer"
import { BibleQuotesCarouselRenderer } from "./BibleQuotesCarouselRenderer"
import { EasterDatesRenderer } from "./EasterDatesRenderer"
import { RelatedQuestionsRenderer } from "./RelatedQuestionsRenderer"
import { QuizButtonRenderer } from "./QuizButtonRenderer"
import { NavigationCarouselRenderer } from "./NavigationCarouselRenderer"
import { VideoCarouselRenderer } from "./VideoCarouselRenderer"
import { MediaCollectionRenderer } from "./MediaCollectionRenderer"
import { PlaceholderRenderer } from "./PlaceholderRenderer"

export interface SectionDispatcherProps {
  section: NormalizedBlock
  /** Parent section index in the top-level sections array (for nested layout registration) */
  parentIndex?: number
}

export function SectionDispatcher({
  section,
  parentIndex,
}: SectionDispatcherProps) {
  const { kind } = section

  switch (kind) {
    case "sectionWrapper":
      return (
        <SectionWrapperRenderer section={section} parentIndex={parentIndex} />
      )
    case "container":
      return <ContainerRenderer section={section} />
    case "videoHero":
      return <VideoHeroRenderer section={section} />
    case "video":
      return <VideoCardRenderer section={section} />
    case "text":
      return <TextRenderer section={section} />
    case "bibleQuotesCarousel":
      return <BibleQuotesCarouselRenderer section={section} />
    case "easterDates":
      return <EasterDatesRenderer section={section} />
    case "relatedQuestions":
      return <RelatedQuestionsRenderer section={section} />
    case "quizButton":
      return <QuizButtonRenderer section={section} />
    case "navigationCarousel":
      return <NavigationCarouselRenderer section={section} />
    case "videoCarousel":
      return <VideoCarouselRenderer section={section} />
    case "mediaCollection":
      return <MediaCollectionRenderer section={section} />
    default:
      return <PlaceholderRenderer section={section} />
  }
}
