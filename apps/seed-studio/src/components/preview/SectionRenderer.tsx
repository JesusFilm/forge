import type { SectionBlock } from "@/lib/ai/experience-schema"

import { BibleQuotesPreview } from "./sections/BibleQuotesPreview"
import { ContainerPreview } from "./sections/ContainerPreview"
import { QuizButtonPreview } from "./sections/QuizButtonPreview"
import { RelatedQuestionsPreview } from "./sections/RelatedQuestionsPreview"
import { TextSectionPreview } from "./sections/TextSectionPreview"
import { VideoCarouselPreview } from "./sections/VideoCarouselPreview"
import { VideoHeroPreview } from "./sections/VideoHeroPreview"
import { VideoSectionPreview } from "./sections/VideoSectionPreview"

type SectionRendererProps = {
  block: SectionBlock
}

export function SectionRenderer({ block }: SectionRendererProps) {
  switch (block.__component) {
    case "sections.video":
      return <VideoSectionPreview section={block} />
    case "sections.video-hero":
      return <VideoHeroPreview section={block} />
    case "sections.video-carousel":
      return <VideoCarouselPreview section={block} />
    case "sections.text":
      return <TextSectionPreview section={block} />
    case "sections.bible-quotes-carousel":
      return <BibleQuotesPreview section={block} />
    case "sections.related-questions":
      return <RelatedQuestionsPreview section={block} />
    case "sections.quiz-button":
      return <QuizButtonPreview section={block} />
    case "sections.container":
      return <ContainerPreview section={block} />
    default:
      return null
  }
}
