import { adminGraphql } from "../../admin"
import { adminBlockVideoDubFragment } from "./video-dub"

/**
 * Items are FLAT in admin (no `items[].video` join or nested media wrapper)
 * wrapper). Renderers use `imageAsset` for authored artwork and video-derived
 * fields for linked-video fallbacks.
 */
export const adminMediaCollectionFragment = adminGraphql(
  `
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
      mediaDefaultCollectionSlug: defaultCollectionSlug
      showItemNumbers
      mediaCollectionVariant: variant
      thumbnailOrientation
      footerText
      imageAssetId
      imageAsset {
        id
        previewUrl
        blurDataUrl
        dominantColor
        width
        height
      }
      backgroundColor
      items {
        videoId
        languageId
        languageSlug
        coreId
        videoDub {
          ...AdminBlockVideoDub
        }
        videoSlug
        videoImage {
          id
          previewUrl
          blurDataUrl
          dominantColor
          width
          height
        }
        titleOverride
        subtitleOverride
        labelOverride
        collectionSize
        imageAssetId
        imageAsset {
          id
          previewUrl
          blurDataUrl
          dominantColor
          width
          height
        }
        linkToSectionKey
      }
    }
  `,
  [adminBlockVideoDubFragment],
)
