import type {
  AdventCountdownBlockSchema,
  BibleQuoteItemSchema,
  BibleQuotesCarouselBlockSchema,
  Block,
  CardBlockSchema,
  ContainerBlock,
  ContainerContentBlock,
  CtaBlockSchema,
  EasterDatesBlockSchema,
  InfoBlockItemSchema,
  InfoBlocksBlockSchema,
  MediaCollectionBlockSchema,
  MediaCollectionItemSchema,
  NavigationCarouselBlockSchema,
  NavigationCarouselItemSchema,
  PromoBannerBlockSchema,
  QuizButtonBlockSchema,
  RelatedQuestionItemSchema,
  RelatedQuestionsBlockSchema,
  SectionBlock,
  SectionContentBlock,
  TextBlockSchema,
  VideoBlockSchema,
  VideoCarouselBlockSchema,
  VideoCarouselItemSchema,
  VideoHeroBlockSchema,
  VideoRecommendationsBlockSchema,
} from "../../../../admin/src/domain/blocks"
import type { z } from "zod"

export type {
  Block,
  ContainerBlock,
  ContainerContentBlock,
  SectionBlock,
  SectionContentBlock,
}

export type AdventCountdownBlock = z.infer<typeof AdventCountdownBlockSchema>
export type BibleQuoteItem = z.infer<typeof BibleQuoteItemSchema>
export type BibleQuotesCarouselBlock = z.infer<
  typeof BibleQuotesCarouselBlockSchema
>
export type CardBlock = z.infer<typeof CardBlockSchema>
export type CtaBlock = z.infer<typeof CtaBlockSchema>
export type EasterDatesBlock = z.infer<typeof EasterDatesBlockSchema>
export type InfoBlockItem = z.infer<typeof InfoBlockItemSchema>
export type InfoBlocksBlock = z.infer<typeof InfoBlocksBlockSchema>
export type MediaCollectionBlock = z.infer<typeof MediaCollectionBlockSchema>
export type MediaCollectionItem = z.infer<typeof MediaCollectionItemSchema>
export type NavigationCarouselBlock = z.infer<
  typeof NavigationCarouselBlockSchema
>
export type NavigationCarouselItem = z.infer<
  typeof NavigationCarouselItemSchema
>
export type PromoBannerBlock = z.infer<typeof PromoBannerBlockSchema>
export type QuizButtonBlock = z.infer<typeof QuizButtonBlockSchema>
export type RelatedQuestionItem = z.infer<typeof RelatedQuestionItemSchema>
export type RelatedQuestionsBlock = z.infer<typeof RelatedQuestionsBlockSchema>
export type TextBlock = z.infer<typeof TextBlockSchema>
export type VideoBlock = z.infer<typeof VideoBlockSchema>
export type VideoCarouselBlock = z.infer<typeof VideoCarouselBlockSchema>
export type VideoCarouselItem = z.infer<typeof VideoCarouselItemSchema>
export type VideoHeroBlock = z.infer<typeof VideoHeroBlockSchema>
export type VideoRecommendationsBlock = z.infer<
  typeof VideoRecommendationsBlockSchema
>

export type HydratedBlockVideo = {
  id: string
  slug?: string | null
  title?: string | null
  description?: string | null
  snippet?: string | null
  streamingUrl?: string | null
  images?: ({ url?: string | null; alt?: string | null } | null)[] | null
  locales?:
    | ({
        title?: string | null
        description?: string | null
        snippet?: string | null
      } | null)[]
    | null
}

export type VideoMap = Map<string, HydratedBlockVideo>

export function videoTitle(video: HydratedBlockVideo | null | undefined) {
  return video?.title ?? video?.locales?.[0]?.title ?? null
}

export function videoDescription(video: HydratedBlockVideo | null | undefined) {
  return (
    video?.snippet ??
    video?.description ??
    video?.locales?.[0]?.snippet ??
    video?.locales?.[0]?.description ??
    null
  )
}

export function videoImageUrl(video: HydratedBlockVideo | null | undefined) {
  return video?.images?.[0]?.url ?? null
}
