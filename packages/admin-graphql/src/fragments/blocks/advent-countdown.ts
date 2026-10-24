import { adminGraphql } from "../../admin"

export const adminAdventCountdownFragment = adminGraphql(`
  fragment AdminAdventCountdown on AdventCountdownBlock @_unmask {
    __typename
    t
    sectionKey
    adventTitle: title
    scripture
    scriptureReference
    locale
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
  }
`)
