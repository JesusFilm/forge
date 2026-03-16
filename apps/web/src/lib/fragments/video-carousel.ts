import { graphql } from "@forge/graphql"

export const videoCarouselFragment = graphql(`
  fragment VideoCarousel on ComponentSectionsVideoCarousel @_unmask {
    id
    sectionKey
    title
    subtitle
    carouselDescription: description
    slides {
      id
      title
      streamingUrl
      imageUrl
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
