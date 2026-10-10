/**
 * KTD-4's lean per-video stream operation: watchVideoFragment's dub selection WITHOUT
 * its `parents → parent → children` chain (~208 nodes / ~1.6s per video the reel never
 * renders) or the watch screen's studyQuestions/bibleCitations tails.
 */

import {
  adminGraphql as graphql,
  type AdminResultOf as ResultOf,
} from "@forge/admin-graphql"

import { withTimeout } from "../withTimeout"
import type { FetchShowcaseVideo } from "./sourceResolution"

/** apps/tv convention: hardcoded English locale for every GraphQL query. */
const SHOWCASE_LOCALE = "en"

/** Under AE5's "few seconds" so a stalled fetch degrades rather than parks the reel. */
const SHOWCASE_VIDEO_FETCH_DEADLINE_MS = 5000

export type ShowcaseFetchPolicy = "cache-first" | "network-only"

// `dubs` is selected UNALIASED: the sibling fragments' `variants:` alias exists only
// for normalizeVideo's mobile-parity WatchVariant type, and renaming a wire field
// through layers is how producer/consumer contracts drift.
export const showcaseVideoFragment = graphql(`
  fragment ShowcaseVideo on Video @_unmask {
    documentId: id
    slug
    label
    images {
      documentId: id
      url
      thumbnail
      mobileCinematicHigh
      mobileCinematicLow
    }
    locales(locale: $locale) {
      documentId: id
      languageSlug
      title
      imageAlt
    }
    dubs {
      published
      hls
      duration
      language {
        slug
        bcp47
        name
      }
      muxVideo {
        playbackId
      }
    }
  }
`)

export const GET_SHOWCASE_VIDEO = graphql(
  `
    query GetShowcaseVideo($locale: String!, $slug: String!) {
      videoBySlug(slug: $slug) {
        ...ShowcaseVideo
      }
    }
  `,
  [showcaseVideoFragment],
)

export type ShowcaseVideoData = ResultOf<typeof GET_SHOWCASE_VIDEO>

/**
 * KTD-2's sentence-timing input: the English dub's edition subtitles, nothing else. Kept
 * OFF the bulk ShowcaseVideo fragment (which forbids `subtitles`) — widening that would
 * add ~2,250 fields per showcase video. `preferredPlayableDub` resolves the English dub;
 * the client picks its English edition subtitle (language.slug === "english") downstream.
 */
export const showcaseSubtitleFragment = graphql(`
  fragment ShowcaseSubtitle on Video @_unmask {
    documentId: id
    preferredPlayableDub(languageSlug: "english") {
      id
      videoEdition {
        id
        subtitles {
          id
          vttSrc
          primary
          aiGenerated
          language {
            slug
          }
        }
      }
    }
  }
`)

export const GET_SHOWCASE_SUBTITLE = graphql(
  `
    query GetShowcaseSubtitle($slug: String!) {
      videoBySlug(slug: $slug) {
        ...ShowcaseSubtitle
      }
    }
  `,
  [showcaseSubtitleFragment],
)

export type ShowcaseSubtitleData = ResultOf<typeof GET_SHOWCASE_SUBTITLE>

// Type-only reference to the app's Apollo client — erased at runtime, so this module
// stays free of the client's (native-adjacent) import graph and unit-tests cleanly.
type ShowcaseApolloClient = ReturnType<
  typeof import("../apolloClient").getApolloClient
>

/**
 * Bind the operation to the client as sourceResolution's injectable seam. Rejections
 * propagate — resolveExcerptStream owns the R16 degrade-to-skip guard.
 */
export function createShowcaseVideoFetcher(
  client: ShowcaseApolloClient,
  fetchPolicy: ShowcaseFetchPolicy = "cache-first",
): FetchShowcaseVideo {
  return async (slug: string) => {
    // AE5 promises a dead item is skipped in a few seconds, but R16 only degrades on
    // a REPORTED failure — an unbounded hang here reports nothing and parks the reel
    // on one poster indefinitely, which is the opposite of the ladder's floor.
    const result = await withTimeout(
      client.query({
        query: GET_SHOWCASE_VIDEO,
        variables: { locale: SHOWCASE_LOCALE, slug },
        fetchPolicy,
      }),
      SHOWCASE_VIDEO_FETCH_DEADLINE_MS,
    )
    return result.data?.videoBySlug ?? null
  }
}
