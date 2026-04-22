import { graphql } from "@forge/graphql"

export const videoHeroFragment = graphql(`
  fragment VideoHero on ComponentSectionsVideoHero @_unmask {
    id
    sectionKey
    useRouteVideo
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
      }
    }
  }
`)
