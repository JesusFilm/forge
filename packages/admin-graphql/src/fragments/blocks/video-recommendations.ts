import { adminGraphql } from "../../admin"

/** Admin-only; renderer fetches scene-similarity at render time via `sceneRecommendations`. */
export const adminVideoRecommendationsFragment = adminGraphql(`
  fragment AdminVideoRecommendations on VideoRecommendationsBlock @_unmask {
    __typename
    t
    sectionKey
    title
    subtitle
    description
    sourceVideoId
    sourceSceneIndex
    limit
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
