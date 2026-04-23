import type {
  CardSection as SharedCardSection,
  CTASection as SharedCTASection,
  InfoBlocksSection as SharedInfoBlocksSection,
  MediaCollectionSection as SharedMediaCollectionSection,
  NavigationCarouselSection as SharedNavigationCarouselSection,
  PromoBannerSection as SharedPromoBannerSection,
  SectionBlock as SharedSectionBlock,
  SectionWrapper as SharedSectionWrapper,
} from "@forge/experience-templates"

import type { SectionBlock as LocalSectionBlock } from "@/lib/ai/experience-schema"

import { BibleQuotesPreview } from "./sections/BibleQuotesPreview"
import { CardPreview } from "./sections/CardPreview"
import { ContainerPreview } from "./sections/ContainerPreview"
import { CtaPreview } from "./sections/CtaPreview"
import { InfoBlocksPreview } from "./sections/InfoBlocksPreview"
import { MediaCollectionPreview } from "./sections/MediaCollectionPreview"
import { NavigationCarouselPreview } from "./sections/NavigationCarouselPreview"
import { PromoBannerPreview } from "./sections/PromoBannerPreview"
import { QuizButtonPreview } from "./sections/QuizButtonPreview"
import { RelatedQuestionsPreview } from "./sections/RelatedQuestionsPreview"
import { SectionWrapperPreview } from "./sections/SectionWrapperPreview"
import { TextSectionPreview } from "./sections/TextSectionPreview"
import { VideoCarouselPreview } from "./sections/VideoCarouselPreview"
import { VideoHeroPreview } from "./sections/VideoHeroPreview"
import { VideoSectionPreview } from "./sections/VideoSectionPreview"

type RenderableBlock =
  | LocalSectionBlock
  | SharedSectionBlock
  | { __component?: string }

type SectionRendererProps = {
  block: RenderableBlock
}

export function SectionRenderer({ block }: SectionRendererProps) {
  if (!block || !block.__component) return null

  switch (block.__component) {
    case "sections.video":
      return <VideoSectionPreview section={block as never} />
    case "sections.video-hero":
      return <VideoHeroPreview section={block as never} />
    case "sections.video-carousel":
      return <VideoCarouselPreview section={block as never} />
    case "sections.text":
      return <TextSectionPreview section={block as never} />
    case "sections.bible-quotes-carousel":
      return <BibleQuotesPreview section={block as never} />
    case "sections.related-questions":
      return <RelatedQuestionsPreview section={block as never} />
    case "sections.quiz-button":
      return <QuizButtonPreview section={block as never} />
    case "sections.container":
      return <ContainerPreview section={block as never} />
    case "sections.section":
      return (
        <SectionWrapperPreview
          section={block as unknown as SharedSectionWrapper}
        />
      )
    case "sections.media-collection":
      return (
        <MediaCollectionPreview
          section={block as unknown as SharedMediaCollectionSection}
        />
      )
    case "sections.navigation-carousel":
      return (
        <NavigationCarouselPreview
          section={block as unknown as SharedNavigationCarouselSection}
        />
      )
    case "sections.cta":
      return <CtaPreview section={block as unknown as SharedCTASection} />
    case "sections.card":
      return <CardPreview section={block as unknown as SharedCardSection} />
    case "sections.info-blocks":
      return (
        <InfoBlocksPreview
          section={block as unknown as SharedInfoBlocksSection}
        />
      )
    case "sections.promo-banner":
      return (
        <PromoBannerPreview
          section={block as unknown as SharedPromoBannerSection}
        />
      )
    default: {
      if (process.env.NODE_ENV === "development") {
        console.warn(`Unknown __component: ${block.__component}`)
      }
      return null
    }
  }
}
