import { adminGraphql } from "../../../admin"

/**
 * Admin-only block (no Strapi precedent). The renderer dispatches
 * dynamically into the VideoRecommendations component which fetches
 * scene-similarity recommendations at render time via the public
 * `sceneRecommendations` query.
 */
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
