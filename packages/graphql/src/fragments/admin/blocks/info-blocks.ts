import { adminGraphql } from "../../../admin"

export const adminInfoBlocksFragment = adminGraphql(`
  fragment AdminInfoBlocks on InfoBlocksBlock @_unmask {
    __typename
    t
    sectionKey
    infoHeading: heading
    intro
    infoDescription: description
    widthPercent
    imageUrl
    imageAssetId
    backgroundColor
    blocks {
      icon
      title
      description
    }
  }
`)
