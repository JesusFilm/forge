// Watch Home bulk query (card-lean); keep in sync with mobile's GET_WATCH_HOME_VIDEOS.
// NEVER add `dubs` — JESUS's ~2,259 dubs = the 9.5MB payload incident; homeQueries.test.ts
// guards it. Streams resolve lazily per slug (GET_VIDEO_BY_SLUG, videoQueries.ts).
import {
  adminGraphql as graphql,
  type AdminResultOf as ResultOf,
} from "@forge/admin-graphql"

export const watchHomeVideoFragment = graphql(`
  fragment WatchHomeVideo on Video @_unmask {
    documentId: id
    coreId
    slug
    label
    durationSeconds
    images {
      documentId: id
      url
      thumbnail
      mobileCinematicHigh
      mobileCinematicLow
      videoStill
    }
    locales(locale: $locale, languageSlug: $languageSlug) {
      documentId: id
      languageSlug
      title
      description
      snippet
      imageAlt
    }
    children {
      child {
        documentId: id
        coreId
        slug
        label
        durationSeconds
        images {
          documentId: id
          url
          thumbnail
          mobileCinematicHigh
          mobileCinematicLow
          videoStill
        }
        locales(locale: $locale, languageSlug: $languageSlug) {
          documentId: id
          languageSlug
          title
          description
          snippet
          imageAlt
        }
      }
    }
  }
`)

export const GET_WATCH_HOME_VIDEOS = graphql(
  `
    query GetWatchHomeVideos(
      $coreIds: [String!]!
      $locale: String!
      $languageSlug: String
    ) {
      watchHomeVideos(coreIds: $coreIds) {
        ...WatchHomeVideo
      }
    }
  `,
  [watchHomeVideoFragment],
)

export type WatchHomeVideosData = ResultOf<typeof GET_WATCH_HOME_VIDEOS>
