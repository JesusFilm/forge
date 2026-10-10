// Apollo wiring for the "Because you watched" rail. Thin by design: every
// decision (seed choice, row filtering, hide-when-empty) lives in the pure
// `recommendationsSection.ts`, mirroring the recordWatchEvent / watchProgress
// split.

import { getApolloClient } from "../apolloClient"
import { HOME_LOCALE } from "../watchHome/config"
import { GET_BECAUSE_YOU_WATCHED } from "./recommendationsDocument"
import {
  RECOMMENDATIONS_LIMIT,
  type RecommendationRow,
} from "./recommendationsSection"

/**
 * Rows for one seed video, or `[]` on any failure.
 *
 * Empty-on-failure rather than throwing: this rail is an enhancement below the
 * fold, and the pure builder already maps `[]` onto "render no rail". A Home
 * screen must never fail to paint because a recommendation lookup did — and
 * admin itself soft-swallows an un-embedded seed to `[]`, so an empty result is
 * an ordinary outcome, not an error condition.
 */
export async function fetchRecommendations(
  seedVideoId: string,
): Promise<RecommendationRow[]> {
  if (!seedVideoId) return []
  try {
    const result = await getApolloClient().query({
      query: GET_BECAUSE_YOU_WATCHED,
      variables: {
        videoId: seedVideoId,
        // BCP-47 here, NOT a language slug: admin compares this against
        // transcript/locale/bcp47 columns. TV's "en" convention matches; the
        // search layer's "english" slug would silently return nothing.
        locale: HOME_LOCALE,
        limit: RECOMMENDATIONS_LIMIT,
      },
      // The seed changes as the viewer watches, and a cached rail would keep
      // recommending against yesterday's video.
      fetchPolicy: "network-only",
      errorPolicy: "all",
    })
    const rows = result.data?.sceneRecommendations
    if (!Array.isArray(rows)) return []
    // Narrowed at the boundary: partial data can carry nulls even with the
    // schema's non-null fields, and the builder downstream expects strings.
    return rows.flatMap((row) =>
      row != null &&
      typeof row.videoId === "string" &&
      typeof row.videoSlug === "string" &&
      typeof row.videoTitle === "string"
        ? [
            {
              videoId: row.videoId,
              videoSlug: row.videoSlug,
              videoTitle: row.videoTitle,
              playbackId:
                typeof row.playbackId === "string" ? row.playbackId : "",
            },
          ]
        : [],
    )
  } catch {
    return []
  }
}
