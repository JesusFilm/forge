import { adminGraphql } from "../../admin"
import { adminBlockVideoDubFragment } from "./video-dub"

/**
 * Items are FLAT in admin (no `items[].video` join or `imageOverride { url }`
 * wrapper). Renderers reading those nested paths see undefined; runtime
 * fallbacks via `titleOverride` / `imageUrl` cover the common path.
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
      imageUrl
      imageAssetId
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
        videoImageBlurDataUrl
        videoImageDominantColor
        titleOverride
        subtitleOverride
        labelOverride
        collectionSize
        imageUrl
        imageAssetId
        imageBlurDataUrl
        imageDominantColor
        imageOverrideUrl
        imageOverrideAssetId
        imageOverrideBlurDataUrl
        imageOverrideDominantColor
        linkToSectionKey
      }
    }
  `,
  [adminBlockVideoDubFragment],
)
