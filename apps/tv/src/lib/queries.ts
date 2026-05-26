// Fragments here are kept structurally in sync with apps/mobile/src/lib/queries.ts.
//
// LIST_EXPERIENCES specifically has DIVERGED from the mobile copy — TV
// selects a per-experience VideoHero block for the focus-driven home
// hero (see the comment on LIST_EXPERIENCES below). Mobile retains
// the lightweight shape. Re-align when mobile gains the same feature;
// do NOT copy mobile's LIST_EXPERIENCES back over the TV version
// without reading this file first.

/**
 * gql.tada typed GraphQL query and fragments for Experience blocks.
 *
 * Defined here in apps/tv/ per convention:
 * "Operations are defined in apps using graphql() from this package."
 *
 * Uses @_unmask to make fragment fields directly accessible on parent results.
 */
import {
  adminGraphql as graphql,
  type AdminResultOf as ResultOf,
} from "@forge/admin-graphql"

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
      linkToSectionKey
      videoId
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

// ContainerSlotContentDynamicZone members (from schema.graphql):
// AdventCountdown, BibleQuotesCarousel, Card, Cta, EasterDates,
// MediaCollection, RelatedQuestions, Text, Video
// NOTE: Container, NavigationCarousel, VideoCarousel, QuizButton are NOT in this union
export const ContainerFragment = graphql(
  `
    fragment ContainerFields on ContainerBlock @_unmask {
      sectionKey
      content {
        __typename
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

// SectionContentDynamicZone members (from schema.graphql):
// BibleQuotesCarousel, Card, Container, Cta, InfoBlocks, MediaCollection,
// NavigationCarousel, PromoBanner, QuizButton, RelatedQuestions, Text, Video, VideoCarousel
// NOTE: EasterDates and AdventCountdown are NOT in this union (only in ContainerSlotContentDynamicZone)
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

// ── Listing query (with VideoHero block for focus-driven hero) ────
//
// LIST_EXPERIENCES powers the TV home screen: both the rail of cards
// and the top-of-page focus-driven hero. We select the first
// VideoHeroBlock block per experience so switching the
// hero on focus requires zero extra round-trips.
//
// Non-VideoHero blocks are still returned over the wire with only
// __typename, which is cheap (N * blocks * ~30 bytes). For the
// current experience count (<20), the total payload stays small.
//
// If experience count grows past ~30, or payload profiling shows
// this query exceeding a reasonable size, consider either:
//   1) Filtering `blocks` server-side to VideoHero only (Strapi
//      filters on dynamic zones), or
//   2) Moving to lazy fetch per-focused-card with on-item-focus.

export const LIST_EXPERIENCES = graphql(
  `
    query ListExperiences($locale: String!) {
      experiences {
        id
        locales(locale: $locale) {
          documentId: id
          slug
          title
          metaDescription
          isHomepage
          ogImageUrl
          blocks {
            __typename
            ... on VideoHeroBlock {
              ...VideoHeroFields
            }
          }
        }
      }
    }
  `,
  [VideoHeroFragment],
)

// ── Semantic search query ─────────────────────────────────────────
//
// Mirrors apps/mobile/src/lib/queries.ts SEMANTIC_SEARCH with one
// addition: we select `searchMode` so the TV search hook can
// distinguish "hybrid" (healthy) from "keyword-only" (degraded
// backend — e.g., OPENROUTER key missing) and render distinct UX.
// Mobile does not consume the degraded signal today; TV does.
//
// $locale is String! because admin's search resolver accepts a plain
// locale string rather than a schema-specific locale enum.

export const SEMANTIC_SEARCH = graphql(`
  query SemanticSearch(
    $query: String!
    $locale: String!
    $limit: Int
    $offset: Int
  ) {
    semanticSearch: search(
      q: $query
      locale: $locale
      limit: $limit
      offset: $offset
    ) {
      query
      hasMore
      searchMode
      results {
        type
        id
        slug
        title
        imageUrl
        snippet
        startSeconds
        playbackId
        score
      }
    }
  }
`)

export type SearchResult = NonNullable<
  ResultOf<typeof SEMANTIC_SEARCH>["semanticSearch"]
>["results"][number]

export type SearchResponse = NonNullable<
  ResultOf<typeof SEMANTIC_SEARCH>["semanticSearch"]
>
