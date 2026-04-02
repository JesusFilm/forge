/**
 * gql.tada typed GraphQL query and fragments for Experience blocks.
 *
 * Defined here in apps/mobile-v2/ per convention:
 * "Operations are defined in apps using graphql() from this package."
 *
 * Uses @_unmask to make fragment fields directly accessible on parent results.
 */
import { graphql } from "@forge/graphql"

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

// Type is inferred by gql.tada at compile time via ResultOf<typeof GET_WATCH_EXPERIENCE>
