// Fragments here are kept structurally in sync with apps/mobile/src/lib/queries.ts.

/**
 * gql.tada typed Experience-block query and fragments. Defined here in apps/tv
 * per convention (operations live in apps, not the package). @_unmask exposes
 * fragment fields directly on parent results.
 */
import { adminGraphql as graphql } from "@forge/admin-graphql"

// ── Leaf fragments ──────────────────────────────────────────────────

export const VideoHeroFragment = graphql(`
  fragment VideoHeroFields on VideoHeroBlock @_unmask {
    sectionKey
    heading
    subheading
    ctaLabel
    ctaLink
    streamingUrl
  }
`)

export const TextSectionFragment = graphql(`
  fragment TextSectionFields on TextBlock @_unmask {
    sectionKey
    textHeading: heading
    headingLevel
    subtitle
    contentParagraphs
    textVariant: variant
  }
`)

export const RelatedQuestionsFragment = graphql(`
  fragment RelatedQuestionsFields on RelatedQuestionsBlock @_unmask {
    sectionKey
    rqHeading: heading
    ctaLabel
    ctaLink
    questions {
      question
      answer
    }
  }
`)

export const BibleQuotesCarouselFragment = graphql(`
  fragment BibleQuotesCarouselFields on BibleQuotesCarouselBlock @_unmask {
    sectionKey
    bqcHeading: heading
    quotes {
      reference
      text
      attribution
      imageUrl
      backgroundColor
      ctaLabel
      ctaLink
    }
  }
`)

export const EasterDatesFragment = graphql(`
  fragment EasterDatesFields on EasterDatesBlock @_unmask {
    sectionKey
    easterDatesTitle
    westernEasterLabel
    orthodoxEasterLabel
    passoverLabel
    locale
  }
`)

export const AdventCountdownFragment = graphql(`
  fragment AdventCountdownFields on AdventCountdownBlock @_unmask {
    sectionKey
    adventTitle: title
    scripture
    scriptureReference
    locale
  }
`)

export const CTASectionFragment = graphql(`
  fragment CTASectionFields on CtaBlock @_unmask {
    sectionKey
    ctaHeading: heading
    body
    buttonLabel
    buttonLink
    ctaVariant: variant
  }
`)

export const VideoSectionFragment = graphql(`
  fragment VideoSectionFields on VideoBlock @_unmask {
    sectionKey
    streamingUrl
    videoTitle: title
    videoSubtitle: subtitle
    videoId
  }
`)

export const NavigationCarouselFragment = graphql(`
  fragment NavigationCarouselFields on NavigationCarouselBlock @_unmask {
    sectionKey
    items {
      contentId
      title
      category
      imageUrl
      backgroundColor
    }
  }
`)

export const MediaCollectionFragment = graphql(`
  fragment MediaCollectionFields on MediaCollectionBlock @_unmask {
    sectionKey
    mcTitle: title
    mcSubtitle: subtitle
    mcDescription: description
    categoryLabel
    mcCtaLink: ctaLink
    mcCtaLabel: ctaLabel
    showItemNumbers
    mcVariant: variant
    footerText
    items {
      titleOverride
      subtitleOverride
      labelOverride
      collectionSize
      imageUrl
      imageOverrideUrl
      linkToSectionKey
      videoId
      coreId
    }
  }
`)

export const VideoCarouselFragment = graphql(`
  fragment VideoCarouselFields on VideoCarouselBlock @_unmask {
    sectionKey
    vcTitle: title
    vcSubtitle: subtitle
    vcDescription: description
    items {
      streamingUrl
      imageUrl
      titleOverride
      backgroundColor
      videoId
    }
  }
`)

export const QuizButtonFragment = graphql(`
  fragment QuizButtonFields on QuizButtonBlock @_unmask {
    buttonText
    iframeSrc
  }
`)

// ── Composite fragments (nested content) ────────────────────────────

// content[] is flat: ContainerSlotBlock markers divide it into side-by-side
// slots (each marker carries the grid span), then content blocks follow.
// Members: AdventCountdown, BibleQuotesCarousel, Card, Cta, EasterDates,
// MediaCollection, RelatedQuestions, Text, Video (+ the ContainerSlot marker).
export const ContainerFragment = graphql(
  `
    fragment ContainerFields on ContainerBlock @_unmask {
      sectionKey
      content {
        __typename
        ... on ContainerSlotBlock {
          gridSpan
          spans {
            xs
            sm
            md
            lg
            xl
          }
        }
        ... on TextBlock {
          ...TextSectionFields
        }
        ... on EasterDatesBlock {
          ...EasterDatesFields
        }
        ... on AdventCountdownBlock {
          ...AdventCountdownFields
        }
        ... on CtaBlock {
          ...CTASectionFields
        }
        ... on VideoBlock {
          ...VideoSectionFields
        }
        ... on RelatedQuestionsBlock {
          ...RelatedQuestionsFields
        }
        ... on BibleQuotesCarouselBlock {
          ...BibleQuotesCarouselFields
        }
        ... on MediaCollectionBlock {
          ...MediaCollectionFields
        }
      }
    }
  `,
  [
    TextSectionFragment,
    EasterDatesFragment,
    AdventCountdownFragment,
    CTASectionFragment,
    VideoSectionFragment,
    RelatedQuestionsFragment,
    BibleQuotesCarouselFragment,
    MediaCollectionFragment,
  ],
)

// SectionContentDynamicZone members: BibleQuotesCarousel, Card, Container, Cta,
// InfoBlocks, MediaCollection, NavigationCarousel, PromoBanner, QuizButton,
// RelatedQuestions, Text, Video, VideoCarousel. NOT here: EasterDates, AdventCountdown.
export const SectionFragment = graphql(
  `
    fragment SectionFields on SectionBlock @_unmask {
      sectionKey
      backgroundColor
      backgroundImageUrl
      backgroundOpacity
      dynamicBackgroundImage
      staticOverlay
      blurHash
      sectionContent: content {
        __typename
        ... on ContainerBlock {
          ...ContainerFields
        }
        ... on VideoBlock {
          ...VideoSectionFields
        }
        ... on RelatedQuestionsBlock {
          ...RelatedQuestionsFields
        }
        ... on BibleQuotesCarouselBlock {
          ...BibleQuotesCarouselFields
        }
        ... on MediaCollectionBlock {
          ...MediaCollectionFields
        }
        ... on QuizButtonBlock {
          ...QuizButtonFields
        }
        ... on VideoCarouselBlock {
          ...VideoCarouselFields
        }
        ... on NavigationCarouselBlock {
          ...NavigationCarouselFields
        }
        ... on TextBlock {
          ...TextSectionFields
        }
        ... on CtaBlock {
          ...CTASectionFields
        }
      }
    }
  `,
  [
    ContainerFragment,
    VideoSectionFragment,
    RelatedQuestionsFragment,
    BibleQuotesCarouselFragment,
    MediaCollectionFragment,
    QuizButtonFragment,
    VideoCarouselFragment,
    NavigationCarouselFragment,
    TextSectionFragment,
    CTASectionFragment,
  ],
)

// ── Main query ──────────────────────────────────────────────────────

export const GET_WATCH_EXPERIENCE = graphql(
  `
    query GetWatchExperience($locale: String!, $slug: String!) {
      experienceBySlug(locale: $locale, slug: $slug) {
        documentId: id
        slug
        title
        blocks {
          __typename
          ... on VideoHeroBlock {
            ...VideoHeroFields
          }
          ... on SectionBlock {
            ...SectionFields
          }
          ... on VideoCarouselBlock {
            ...VideoCarouselFields
          }
          ... on MediaCollectionBlock {
            ...MediaCollectionFields
          }
          ... on NavigationCarouselBlock {
            ...NavigationCarouselFields
          }
          ... on TextBlock {
            ...TextSectionFields
          }
          ... on EasterDatesBlock {
            ...EasterDatesFields
          }
          ... on AdventCountdownBlock {
            ...AdventCountdownFields
          }
          ... on BibleQuotesCarouselBlock {
            ...BibleQuotesCarouselFields
          }
          ... on CtaBlock {
            ...CTASectionFields
          }
          ... on RelatedQuestionsBlock {
            ...RelatedQuestionsFields
          }
          ... on ContainerBlock {
            ...ContainerFields
          }
          ... on VideoBlock {
            ...VideoSectionFields
          }
        }
      }
    }
  `,
  [
    VideoHeroFragment,
    SectionFragment,
    VideoCarouselFragment,
    MediaCollectionFragment,
    NavigationCarouselFragment,
    TextSectionFragment,
    EasterDatesFragment,
    AdventCountdownFragment,
    BibleQuotesCarouselFragment,
    CTASectionFragment,
    RelatedQuestionsFragment,
    ContainerFragment,
    VideoSectionFragment,
  ],
)

// ── Search result shape ─────────────────────────────────────────────
// TODO(feat-254): TV is outside the P0 Watch web search migration. Keep the
// UI-facing shape local so Admin can replace Query.search without breaking CI.

export type SearchResult = {
  readonly type: string
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly imageUrl: string | null
  readonly snippet: string | null
  readonly startSeconds: number | null
  readonly playbackId: string | null
  readonly score: number | null
  readonly label: string | null
  readonly childCount: number | null
}

export type SearchResponse = {
  readonly query: string
  readonly hasMore: boolean
  readonly results: readonly SearchResult[]
}
