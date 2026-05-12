import { adminGraphql } from "../../../admin"

/**
 * Admin-shape MediaCollectionBlock fragment.
 *
 * Field aliases mirror the Strapi fragment's output vocabulary so the
 * web renderer's destructure (`mediaCollectionVariant`, `mediaCtaLink`,
 * `mediaCtaLabel`, `mediaDescription`) stays compatible across the
 * cutover. Items are FLAT in admin — there is no `items[].video`
 * relation or `items[].imageOverride { url }` wrapper. Renderers that
 * historically read those nested paths will see `undefined`; the
 * runtime fallbacks (`titleOverride`, `imageUrl`) already cover the
 * common rendering path. Video-relation hydration is U6's scope.
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
