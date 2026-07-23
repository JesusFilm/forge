// LEGACY PROPS-ONLY — Strapi fragment kept for prop-type derivation
// in section components (`FragmentOf<typeof xFragment>`). Runtime data
// is admin-shape post-U22; this fragment never reaches an admin Apollo
// query. Do not add new operations against it. Migrating section
// components to AdminFragmentOf is a clean follow-up bundle — see
// apps/web/CLAUDE.md "Common Pitfalls".
import { graphql } from "@/lib/legacy-fragment-types"

export const mediaCollectionFragment = graphql(`
  fragment MediaCollection on ComponentSectionsMediaCollection @_unmask {
    id
    title
    subtitle
    mediaDescription: description
    backgroundColor
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
