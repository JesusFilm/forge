import { graphql } from "@forge/graphql"

export const mediaCollectionFragment = graphql(`
  fragment MediaCollection on ComponentSectionsMediaCollection @_unmask {
    id
    title
    subtitle
    mediaDescription: description
    categoryLabel
    itemsSource
    mediaCtaLink: ctaLink
    mediaCtaLabel: ctaLabel
    showItemNumbers
    mediaCollectionVariant: variant
    footerText
    items {
      id
      titleOverride
      subtitleOverride
      labelOverride
      collectionSize
      imageUrl
      imageOverride {
        url
      }
      video {
        documentId
        title
        slug
        images {
          url
        }
      }
    }
  }
`)
