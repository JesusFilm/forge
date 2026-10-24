// The "Because you watched" query, alone in its own module — same split as
// watchProgressDocuments.ts: a document is data, and keeping it free of the
// Apollo client (which reaches the native Datadog SDK, unparseable under jest)
// is what makes its shape and name assertable at all.
//
// CREDENTIAL NOTE, deliberate: this operation is NOT in `USER_TOKEN_OPERATIONS`
// or `FLEET_TOKEN_OPERATIONS` (authHeaders.ts), so it goes out anonymous.
// `sceneRecommendations` is a PUBLIC field, so that is not a 401 — it only
// means admin buckets the call per-IP rather than per-install. Widening the
// fleet key to cover it would MOVE rate-limit identity for this surface, which
// is a policy change, not a drive-by: authHeaders.ts documents that the fleet
// key is scoped to search on purpose.

import { adminGraphql } from "@forge/admin-graphql"

/**
 * Transcript-embedding similarity recommendations for one seed video.
 *
 * Seeded by `videoId` (admin's cuid) rather than slug: TV already holds the
 * documentId, and passing it skips a slug→id lookup server-side.
 *
 * `imageUrl` is deliberately NOT selected — admin hardcodes it to null on this
 * type, so selecting it would read as art that never arrives. Card art comes
 * from `playbackId` via `getMuxThumbnailUrlFromPlaybackId`.
 *
 * `description` is also not selected: it is the matching TRANSCRIPT excerpt,
 * not a synopsis, and reads as noise on a 10-foot card.
 */
export const GET_BECAUSE_YOU_WATCHED = adminGraphql(`
  query BecauseYouWatched($videoId: ID!, $locale: String!, $limit: Int) {
    sceneRecommendations(videoId: $videoId, locale: $locale, limit: $limit) {
      videoId
      videoSlug
      videoTitle
      playbackId
    }
  }
`)
