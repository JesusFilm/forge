// ── Watch Home bulk query (card-lean by design) ─────────────────────
//
// Kept field-for-field in sync with apps/mobile/src/lib/queries.ts
// (`watchHomeVideoFragment` / GET_WATCH_HOME_VIDEOS). The home query fetches
// ~30 core IDs in one round trip, and the set includes the JESUS film whose
// ~2,259 dubs re-create the 9.5MB payload incident if projected in bulk.
// Cards need only ids/slug/label/duration/images/locales; playable streams
// resolve lazily at selection time (GET_VIDEO_BY_SLUG, see videoQueries.ts).
// NEVER add `dubs` here — homeQueries.test.ts guards it. The shape must
// satisfy WatchHomeVideoInput in ./model.ts.
//
// Defined here in apps/tv/ per convention:
// "Operations are defined in apps using graphql() from this package."
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
