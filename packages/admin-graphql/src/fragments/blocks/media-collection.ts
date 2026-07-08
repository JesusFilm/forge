import { adminGraphql } from "../../admin"

/**
 * Items are FLAT in admin (no `items[].video` join or `imageOverride { url }`
 * wrapper). Renderers reading those nested paths see undefined; runtime
 * fallbacks via `titleOverride` / `imageUrl` cover the common path.
 */
export const adminMediaCollectionFragment = adminGraphql(`
  fragment AdminMediaCollection on MediaCollectionBlock @_unmask {
    __typename
    t
    sectionKey
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
    imageUrl
    imageAssetId
    backgroundColor
    items {
      videoId
      videoSlug
      muxPlaybackId
      titleOverride
      subtitleOverride
      labelOverride
      collectionSize
      imageUrl
      imageAssetId
      imageOverrideUrl
      imageOverrideAssetId
      linkToSectionKey
    }
  }
`)
