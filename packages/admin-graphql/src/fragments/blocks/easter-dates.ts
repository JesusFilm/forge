import { adminGraphql } from "../../admin"

export const adminEasterDatesFragment = adminGraphql(`
  fragment AdminEasterDates on EasterDatesBlock @_unmask {
    __typename
    t
    sectionKey
    easterDatesTitle
    westernEasterLabel
    westernEasterEnabled
    orthodoxEasterLabel
    orthodoxEasterEnabled
    passoverLabel
    passoverEnabled
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
