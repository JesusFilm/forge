import { View } from "react-native"

import type { AdminBlock } from "../../lib/queries"
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

export interface ContentDispatcherProps {
  content: AdminBlock[]
}

function renderBlock(block: AdminBlock, index: number) {
  const key = `${block.__typename}-${index}`

  switch (block.__typename) {
    case "VideoBlock":
      return <VideoCardRenderer key={key} section={block} />
    case "TextBlock":
      return <TextRenderer key={key} section={block} />
    case "RelatedQuestionsBlock":
      return <RelatedQuestionsRenderer key={key} section={block} />
    case "BibleQuotesCarouselBlock":
      return <BibleQuotesCarouselRenderer key={key} section={block} />
    case "MediaCollectionBlock":
      return <MediaCollectionRenderer key={key} section={block} />
    case "VideoCarouselBlock":
      return <VideoCarouselRenderer key={key} section={block} />
    case "NavigationCarouselBlock":
      return <NavigationCarouselRenderer key={key} section={block} />
    case "QuizButtonBlock":
      return <QuizButtonRenderer key={key} section={block} />
    case "EasterDatesBlock":
      return <EasterDatesRenderer key={key} section={block} />
    case "ContainerBlock":
      return <ContainerRenderer key={key} section={block} />
    case "AdventCountdownBlock":
    case "CtaBlock":
      return null
    default:
      if (__DEV__) {
        console.warn(`[ContentDispatcher] Unhandled type: ${block.__typename}`)
      }
      return null
  }
}

export function ContentDispatcher({ content }: ContentDispatcherProps) {
  return <View>{content.map((block, index) => renderBlock(block, index))}</View>
}
