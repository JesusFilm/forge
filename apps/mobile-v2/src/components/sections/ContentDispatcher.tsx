import { View } from "react-native"

import type { NormalizedBlock } from "../../lib/normalizer"
import { VideoCardRenderer } from "./VideoCardRenderer"
import { TextRenderer } from "./TextRenderer"
import { RelatedQuestionsRenderer } from "./RelatedQuestionsRenderer"
import { BibleQuotesCarouselRenderer } from "./BibleQuotesCarouselRenderer"
import { MediaCollectionRenderer } from "./MediaCollectionRenderer"
import { VideoCarouselRenderer } from "./VideoCarouselRenderer"
import { NavigationCarouselRenderer } from "./NavigationCarouselRenderer"
import { QuizButtonRenderer } from "./QuizButtonRenderer"
import { EasterDatesRenderer } from "./EasterDatesRenderer"
import { ContainerRenderer } from "./ContainerRenderer"

/**
 * Recursive dispatcher for nested content inside SectionWrapper and Container.
 * Unlike SectionDispatcher (which handles top-level feed items), this renders
 * content blocks that live inside a parent wrapper.
 */
export interface ContentDispatcherProps {
  content: NormalizedBlock[]
}

function renderBlock(block: NormalizedBlock, index: number) {
  const key = `${block.kind}-${(block.id as string) ?? "x"}-${index}`

  switch (block.kind) {
    case "video":
      return <VideoCardRenderer key={key} section={block} />
    case "text":
      return <TextRenderer key={key} section={block} />
    case "relatedQuestions":
      return <RelatedQuestionsRenderer key={key} section={block} />
    case "bibleQuotesCarousel":
      return <BibleQuotesCarouselRenderer key={key} section={block} />
    case "mediaCollection":
      return <MediaCollectionRenderer key={key} section={block} />
    case "videoCarousel":
      return <VideoCarouselRenderer key={key} section={block} />
    case "navigationCarousel":
      return <NavigationCarouselRenderer key={key} section={block} />
    case "quizButton":
      return <QuizButtonRenderer key={key} section={block} />
    case "easterDates":
      return <EasterDatesRenderer key={key} section={block} />
    case "container":
      return <ContainerRenderer key={key} section={block} />
    case "adventCountdown":
    case "cta":
      // TODO: implement dedicated renderers
      return null
    default:
      if (__DEV__) {
        console.warn(`[ContentDispatcher] Unhandled kind: ${block.kind}`)
      }
      return null
  }
}

export function ContentDispatcher({ content }: ContentDispatcherProps) {
  return <View>{content.map((block, index) => renderBlock(block, index))}</View>
}
