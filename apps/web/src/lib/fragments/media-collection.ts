import { graphql } from "@forge/graphql"

export const mediaCollectionFragment = graphql(`
  fragment MediaCollection on ComponentSectionsMediaCollection @_unmask {
    id
    title
    subtitle
    mediaDescription: description
    categoryLabel
    mediaCtaLink: ctaLink
    showItemNumbers
    mediaCollectionVariant: variant
    items {
      id
      titleOverride
      subtitleOverride
      imageOverride {
        url
      }
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
