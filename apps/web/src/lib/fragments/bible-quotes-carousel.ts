import { graphql } from "@forge/graphql"

export const bibleQuotesCarouselFragment = graphql(`
  fragment BibleQuotesCarousel on ComponentSectionsBibleQuotesCarousel
  @_unmask {
    __typename
    id
    sectionKey
    heading
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
