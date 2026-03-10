import { graphql } from "@forge/graphql"

export const videoSectionFragment = graphql(`
  fragment VideoSection on ComponentSectionsVideo @_unmask {
    id
    sectionKey
    streamingUrl
    title
    subtitle
    media {
      url
    }
    videoRef: video {
      documentId
      title
      slug
      image {
        url
      }
    }
  }
`)
