import { adminGraphql } from "../../admin"

export const adminInfoBlocksFragment = adminGraphql(`
  fragment AdminInfoBlocks on InfoBlocksBlock @_unmask {
    __typename
    t
    sectionKey
    infoHeading: heading
    intro
    infoDescription: description
    widthPercent
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
    blocks {
      icon
      title
      description
    }
  }
`)
