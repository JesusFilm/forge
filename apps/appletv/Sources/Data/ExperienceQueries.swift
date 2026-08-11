import Foundation

/// The SDUI Experience document — one query for a whole authored page.
///
/// Ported from `apps/tv/src/lib/queries.ts` (`GET_WATCH_EXPERIENCE`). Two
/// deliberate differences from that document, both recorded here because they
/// change what the server does:
///
/// 1. **`items` is aliased three ways** (`mcItems` / `vcItems` / `ncItems`).
///    The React Native client decodes into a typed union, so three unrelated
///    item shapes can share the name `items`. This app decodes every block
///    into ONE all-optional `WireExperienceBlock` (the house pattern from
///    `Core/Models.swift`), and a single struct cannot hold three different
///    types under one key. The aliases are the reason that pattern survives
///    13 block kinds. Every other alias here (`mcTitle`, `vcTitle`,
///    `textHeading`, …) exists in the RN document for the same reason.
///
/// 2. **`resolvedTitle(locale:)` replaces RN's hydration round trip.** RN
///    collects every MediaCollection item's `coreId` and issues a SECOND query
///    (`watchHomeVideos`) purely to learn each card's title. Admin exposes the
///    same answer on the item itself — "authored title override or the first
///    nonblank published title for the linked Video in the exact requested
///    locale" — so this client asks for it directly and never makes the second
///    request. Verified against production on `easter` (returns "JESUS",
///    "Life of Jesus (Gospel of John)", …).
///
/// Fields RN selects but no renderer reads (`headingLevel`, `variant`,
/// `showItemNumbers`, `footerText`, `mcCtaLink/Label`, `backgroundOpacity`,
/// `blurHash`, …) are deliberately NOT selected — dead payload on every page
/// load. `AdventCountdownBlock` selects nothing but `__typename` for the same
/// reason: it has no renderer in either app (see `ExperienceProjection`).
enum ExperienceQueries {
    static let experienceBySlug = """
    query TvNativeExperience($locale: String!, $slug: String!) {
      experienceBySlug(locale: $locale, slug: $slug) {
        id
        slug
        title
        blocks {
          __typename
          ...VideoHeroFields
          ...SectionFields
          ...VideoCarouselFields
          ...MediaCollectionFields
          ...NavigationCarouselFields
          ...TextFields
          ...EasterDatesFields
          ...BibleQuotesFields
          ...CtaFields
          ...RelatedQuestionsFields
          ...ContainerFields
          ...VideoFields
        }
      }
    }

    fragment VideoHeroFields on VideoHeroBlock {
      sectionKey
      heading
      subheading
      ctaLabel
      videoDub { muxVideo { playbackId } }
    }

    fragment TextFields on TextBlock {
      sectionKey
      textHeading: heading
      subtitle
      contentParagraphs
    }

    fragment RelatedQuestionsFields on RelatedQuestionsBlock {
      sectionKey
      rqHeading: heading
      questions { question answer }
    }

    fragment BibleQuotesFields on BibleQuotesCarouselBlock {
      sectionKey
      bqcHeading: heading
      quotes {
        reference
        text
        attribution
        backgroundColor
        ctaLabel
        ctaLink
        imageAsset { previewUrl }
        backgroundImageAsset { previewUrl }
      }
    }

    fragment EasterDatesFields on EasterDatesBlock {
      sectionKey
      easterDatesTitle
      westernEasterLabel
      orthodoxEasterLabel
      passoverLabel
      locale
    }

    fragment CtaFields on CtaBlock {
      sectionKey
      ctaHeading: heading
      body
      buttonLabel
      buttonLink
    }

    fragment VideoFields on VideoBlock {
      sectionKey
      videoTitle: title
      videoSubtitle: subtitle
      videoId
      videoDub { muxVideo { playbackId } }
    }

    fragment NavigationCarouselFields on NavigationCarouselBlock {
      sectionKey
      ncItems: items {
        contentId
        title
        category
        backgroundColor
        imageAsset { previewUrl }
      }
    }

    fragment MediaCollectionFields on MediaCollectionBlock {
      sectionKey
      mcTitle: title
      mcSubtitle: subtitle
      categoryLabel
      thumbnailOrientation
      mcItems: items {
        titleOverride
        labelOverride
        collectionSize
        linkToSectionKey
        videoSlug
        videoId
        resolvedTitle(locale: $locale)
        imageAsset { previewUrl }
        videoImage { previewUrl }
        videoDub { muxVideo { playbackId } }
      }
    }

    fragment VideoCarouselFields on VideoCarouselBlock {
      sectionKey
      vcTitle: title
      vcSubtitle: subtitle
      vcItems: items {
        titleOverride
        backgroundColor
        videoId
        imageAsset { previewUrl }
        videoDub { muxVideo { playbackId } }
      }
    }

    fragment QuizButtonFields on QuizButtonBlock {
      sectionKey
      buttonText
      iframeSrc
    }

    fragment ContainerFields on ContainerBlock {
      sectionKey
      content {
        __typename
        ... on ContainerSlotBlock { gridSpan spans { xs sm md lg xl } }
        ...TextFields
        ...EasterDatesFields
        ...CtaFields
        ...VideoFields
        ...RelatedQuestionsFields
        ...BibleQuotesFields
        ...MediaCollectionFields
      }
    }

    fragment SectionFields on SectionBlock {
      sectionKey
      backgroundImageAsset { previewUrl }
      sectionContent: content {
        __typename
        ...ContainerFields
        ...VideoFields
        ...RelatedQuestionsFields
        ...BibleQuotesFields
        ...MediaCollectionFields
        ...QuizButtonFields
        ...VideoCarouselFields
        ...NavigationCarouselFields
        ...TextFields
        ...CtaFields
      }
    }
    """
}

// MARK: - Wire shapes

struct ExperienceData: Decodable {
    let experienceBySlug: WireExperienceLocale?
}

struct WireExperienceLocale: Decodable {
    let id: String?
    let slug: String?
    let title: String?
    let blocks: [WireExperienceBlock]?
}

/// ONE struct for every block kind at every nesting level.
///
/// The GraphQL union is decoded by `__typename` in `ExperienceProjection`, not
/// by the decoder — every field is optional and only the ones the matched
/// inline fragment selected arrive populated. This mirrors `WireBlock` in
/// `Core/Models.swift`; a `Decodable` union with 13 arms would triple the
/// surface for no behavioral gain, and the alias scheme above guarantees no
/// two kinds claim the same key with different types.
///
/// Recursion (`content`, `sectionContent`) is legal because both are arrays —
/// the array's indirection bounds the struct's size.
struct WireExperienceBlock: Decodable {
    let __typename: String?
    let sectionKey: String?

    // VideoHeroBlock
    let heading: String?
    let subheading: String?
    let ctaLabel: String?
    let videoDub: WireDub?

    // TextBlock
    let textHeading: String?
    let subtitle: String?
    let contentParagraphs: [String]?

    // RelatedQuestionsBlock
    let rqHeading: String?
    let questions: [WireQuestion]?

    // BibleQuotesCarouselBlock
    let bqcHeading: String?
    let quotes: [WireQuote]?

    // EasterDatesBlock
    let easterDatesTitle: String?
    let westernEasterLabel: String?
    let orthodoxEasterLabel: String?
    let passoverLabel: String?
    let locale: String?

    // CtaBlock
    let ctaHeading: String?
    let body: String?
    let buttonLabel: String?
    let buttonLink: String?

    // VideoBlock
    let videoTitle: String?
    let videoSubtitle: String?
    let videoId: String?

    // NavigationCarouselBlock
    let ncItems: [WireNavigationItem]?

    // MediaCollectionBlock
    let mcTitle: String?
    let mcSubtitle: String?
    let categoryLabel: String?
    let thumbnailOrientation: String?
    let mcItems: [WireMediaItem]?

    // VideoCarouselBlock
    let vcTitle: String?
    let vcSubtitle: String?
    let vcItems: [WireCarouselItem]?

    // QuizButtonBlock
    let buttonText: String?
    let iframeSrc: String?

    // ContainerBlock + its ContainerSlotBlock markers
    let content: [WireExperienceBlock]?
    let gridSpan: Int?
    let spans: WireContainerSpans?

    // SectionBlock
    let backgroundImageAsset: WirePreview?
    let sectionContent: [WireExperienceBlock]?
}

struct WireQuestion: Decodable {
    let question: String?
    let answer: String?
}

struct WireQuote: Decodable {
    let reference: String?
    let text: String?
    let attribution: String?
    let backgroundColor: String?
    let ctaLabel: String?
    let ctaLink: String?
    let imageAsset: WirePreview?
    let backgroundImageAsset: WirePreview?
}

struct WireNavigationItem: Decodable {
    let contentId: String?
    let title: String?
    let category: String?
    let backgroundColor: String?
    let imageAsset: WirePreview?
}

struct WireMediaItem: Decodable {
    let titleOverride: String?
    let labelOverride: String?
    /// A STRING on the wire ("61 chapters"), not a count — rendered verbatim.
    let collectionSize: String?
    let linkToSectionKey: String?
    let videoSlug: String?
    let videoId: String?
    let resolvedTitle: String?
    let imageAsset: WirePreview?
    let videoImage: WirePreview?
    let videoDub: WireDub?
}

struct WireCarouselItem: Decodable {
    let titleOverride: String?
    let backgroundColor: String?
    let videoId: String?
    let imageAsset: WirePreview?
    let videoDub: WireDub?
}

struct WireContainerSpans: Decodable {
    let xs: Int?
    let sm: Int?
    let md: Int?
    let lg: Int?
    let xl: Int?
}
