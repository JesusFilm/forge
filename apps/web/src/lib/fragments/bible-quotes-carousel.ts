import { graphql } from "@forge/graphql"

export const bibleQuotesCarouselFragment = graphql(`
  fragment BibleQuotesCarousel on ComponentSectionsBibleQuotesCarousel
  @_unmask {
    id
    heading
  }
`)
