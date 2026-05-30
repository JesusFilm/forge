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
    imageUrl
    backgroundColor
  }
`)
