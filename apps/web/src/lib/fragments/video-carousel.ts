import { graphql } from "@forge/graphql"

export const videoCarouselFragment = graphql(`
  fragment VideoCarousel on ComponentSectionsVideoCarousel @_unmask {
    id
    sectionKey
    title
    subtitle
    carouselDescription: description
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
        image {
          url
        }
      }
    }
  }
`)
