import { graphql } from "@forge/graphql"

export const videoCarouselFragment = graphql(`
  fragment VideoCarousel on ComponentSectionsVideoCarousel @_unmask {
    __typename
    id
    sectionKey
    title
    subtitle
    description
    ctaLabel
    ctaLink
    slides {
      id
      streamingUrl
      imageUrl
      backgroundColor
      title
      label
    }
  }
`)
