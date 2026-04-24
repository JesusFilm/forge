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
import { graphql, type ResultOf } from "@forge/graphql"

// ── Leaf fragments ──────────────────────────────────────────────────

export const VideoHeroFragment = graphql(`
  fragment VideoHeroFields on ComponentSectionsVideoHero @_unmask {
    id
    sectionKey
    heading
    subheading
    ctaLabel
    ctaLink
    streamingUrl
    video {
      documentId
      title
      slug
      images {
        url
        mobileCinematicHigh
        videoStill
      }
    }
  }
`)

export const TextSectionFragment = graphql(`
  fragment TextSectionFields on ComponentSectionsText @_unmask {
    id
    sectionKey
    textHeading: heading
    headingLevel
    subtitle
    contentParagraphs
    textVariant: variant
  }
`)

export const RelatedQuestionsFragment = graphql(`
  fragment RelatedQuestionsFields on ComponentSectionsRelatedQuestions
  @_unmask {
    id
    sectionKey
    rqHeading: heading
    ctaLabel
    ctaLink
    questions {
      id
      question
      answer
    }
  }
`)

export const BibleQuotesCarouselFragment = graphql(`
  fragment BibleQuotesCarouselFields on ComponentSectionsBibleQuotesCarousel
  @_unmask {
    id
    sectionKey
    bqcHeading: heading
    quotes {
      id
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
  fragment EasterDatesFields on ComponentSectionsEasterDates @_unmask {
    id
    sectionKey
    easterDatesTitle
    westernEasterLabel
    orthodoxEasterLabel
    passoverLabel
    locale
  }
`)

export const AdventCountdownFragment = graphql(`
  fragment AdventCountdownFields on ComponentSectionsAdventCountdown @_unmask {
    id
    sectionKey
    adventTitle: title
    scripture
    scriptureReference
    locale
  }
`)

export const CTASectionFragment = graphql(`
  fragment CTASectionFields on ComponentSectionsCta @_unmask {
    id
    sectionKey
    ctaHeading: heading
    body
    buttonLabel
    buttonLink
    ctaVariant: variant
  }
`)

export const VideoSectionFragment = graphql(`
  fragment VideoSectionFields on ComponentSectionsVideo @_unmask {
    id
    sectionKey
    streamingUrl
    videoTitle: title
    videoSubtitle: subtitle
    media {
      url
    }
    videoRef: video {
      documentId
      title
      slug
      imageAlt
      images {
        url
        mobileCinematicHigh
        videoStill
      }
    }
  }
`)

export const NavigationCarouselFragment = graphql(`
  fragment NavigationCarouselFields on ComponentSectionsNavigationCarousel
  @_unmask {
    id
    sectionKey
    items {
      id
      contentId
      title
      category
      imageUrl
      backgroundColor
    }
  }
`)

export const MediaCollectionFragment = graphql(`
  fragment MediaCollectionFields on ComponentSectionsMediaCollection @_unmask {
    id
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
      id
      titleOverride
      subtitleOverride
      labelOverride
      collectionSize
      imageUrl
      linkToSectionKey
      video {
        documentId
        title
        slug
        imageAlt
        images {
          url
          mobileCinematicHigh
          videoStill
        }
      }
    }
  }
`)

export const VideoCarouselFragment = graphql(`
  fragment VideoCarouselFields on ComponentSectionsVideoCarousel @_unmask {
    id
    sectionKey
    vcTitle: title
    vcSubtitle: subtitle
    vcDescription: description
    items {
      id
      streamingUrl
      imageUrl
      titleOverride
      backgroundColor
      video {
        documentId
        title
        slug
        imageAlt
        images {
          url
          mobileCinematicHigh
          videoStill
        }
      }
    }
  }
`)

export const QuizButtonFragment = graphql(`
  fragment QuizButtonFields on ComponentSectionsQuizButton @_unmask {
    id
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
    fragment ContainerFields on ComponentSectionsContainer @_unmask {
      id
      sectionKey
      slots {
        id
        gridSpan
        spans
        slotContent: content {
          __typename
          ... on ComponentSectionsText {
            ...TextSectionFields
          }
          ... on ComponentSectionsEasterDates {
            ...EasterDatesFields
          }
          ... on ComponentSectionsAdventCountdown {
            ...AdventCountdownFields
          }
          ... on ComponentSectionsCta {
            ...CTASectionFields
          }
          ... on ComponentSectionsVideo {
            ...VideoSectionFields
          }
          ... on ComponentSectionsRelatedQuestions {
            ...RelatedQuestionsFields
          }
          ... on ComponentSectionsBibleQuotesCarousel {
            ...BibleQuotesCarouselFields
          }
          ... on ComponentSectionsMediaCollection {
            ...MediaCollectionFields
          }
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
    fragment SectionFields on ComponentSectionsSection @_unmask {
      id
      sectionKey
      backgroundColor
      backgroundImageUrl
      backgroundOpacity
      dynamicBackgroundImage
      staticOverlay
      blurHash
      sectionContent: content {
        __typename
        ... on ComponentSectionsContainer {
          ...ContainerFields
        }
        ... on ComponentSectionsVideo {
          ...VideoSectionFields
        }
        ... on ComponentSectionsRelatedQuestions {
          ...RelatedQuestionsFields
        }
        ... on ComponentSectionsBibleQuotesCarousel {
          ...BibleQuotesCarouselFields
        }
        ... on ComponentSectionsMediaCollection {
          ...MediaCollectionFields
        }
        ... on ComponentSectionsQuizButton {
          ...QuizButtonFields
        }
        ... on ComponentSectionsVideoCarousel {
          ...VideoCarouselFields
        }
        ... on ComponentSectionsNavigationCarousel {
          ...NavigationCarouselFields
        }
        ... on ComponentSectionsText {
          ...TextSectionFields
        }
        ... on ComponentSectionsCta {
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
    query GetWatchExperience(
      $locale: I18NLocaleCode!
      $filters: ExperienceFiltersInput!
    ) {
      experiences(filters: $filters, locale: $locale) {
        documentId
        slug
        title
        blocks {
          __typename
          ... on ComponentSectionsVideoHero {
            ...VideoHeroFields
          }
          ... on ComponentSectionsSection {
            ...SectionFields
          }
          ... on ComponentSectionsVideoCarousel {
            ...VideoCarouselFields
          }
          ... on ComponentSectionsMediaCollection {
            ...MediaCollectionFields
          }
          ... on ComponentSectionsNavigationCarousel {
            ...NavigationCarouselFields
          }
          ... on ComponentSectionsText {
            ...TextSectionFields
          }
          ... on ComponentSectionsEasterDates {
            ...EasterDatesFields
          }
          ... on ComponentSectionsAdventCountdown {
            ...AdventCountdownFields
          }
          ... on ComponentSectionsBibleQuotesCarousel {
            ...BibleQuotesCarouselFields
          }
          ... on ComponentSectionsCta {
            ...CTASectionFields
          }
          ... on ComponentSectionsRelatedQuestions {
            ...RelatedQuestionsFields
          }
          ... on ComponentSectionsContainer {
            ...ContainerFields
          }
          ... on ComponentSectionsVideo {
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
// ComponentSectionsVideoHero block per experience so switching the
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
    query ListExperiences($locale: I18NLocaleCode!) {
      experiences(locale: $locale) {
        documentId
        slug
        title
        metaDescription
        isHomepage
        ogImage {
          url
          alternativeText
          width
          height
        }
        blocks {
          __typename
          ... on ComponentSectionsVideoHero {
            ...VideoHeroFields
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
// $locale is String! (not I18NLocaleCode!) because semanticSearch is
// a CMS custom resolver, not a Strapi-generated query. Using
// I18NLocaleCode! here produces a gql.tada compile-time type
// mismatch with a confusing error.

export const SEMANTIC_SEARCH = graphql(`
  query SemanticSearch(
    $query: String!
    $locale: String!
    $limit: Int
    $offset: Int
  ) {
    semanticSearch(
      query: $query
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

export type SearchResult = ResultOf<
  typeof SEMANTIC_SEARCH
>["semanticSearch"]["results"][number]

export type SearchResponse = ResultOf<typeof SEMANTIC_SEARCH>["semanticSearch"]
