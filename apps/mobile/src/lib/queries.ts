/**
 * Admin GraphQL operations for Experience blocks and search.
 *
 * Uses adminGraphql() from @forge/admin-graphql with the shared
 * AdminWatchExperience fragment that composes all block fragments.
 */
import {
  adminGraphql,
  type AdminFragmentOf,
  type AdminResultOf,
} from "@forge/admin-graphql"
import { adminWatchExperienceFragment } from "@forge/admin-graphql/fragments"

// ── Experience queries ──────────────────────────────────────────────

export const GET_EXPERIENCE_BY_SLUG = adminGraphql(
  `
    query GetExperienceBySlug($locale: String!, $slug: String!) {
      experienceBySlug(locale: $locale, slug: $slug) {
        ...AdminWatchExperience
      }
    }
  `,
  [adminWatchExperienceFragment],
)

export const GET_WATCH_SETTING = adminGraphql(
  `
    query GetWatchSetting($locale: String!) {
      watchSetting(locale: $locale) {
        documentId
        homepageExperience {
          ...AdminWatchExperience
        }
      }
    }
  `,
  [adminWatchExperienceFragment],
)

// ── Search query ────────────────────────────────────────────────────

export const SEARCH = adminGraphql(`
  query Search(
    $q: String!
    $locale: String!
    $limit: Int
    $offset: Int
  ) {
    search(
      q: $q
      locale: $locale
      limit: $limit
      offset: $offset
    ) {
      query
      hasMore
      results {
        type
        id
        slug
        title
        imageUrl
        snippet
        startSeconds
        playbackId
        score
        label
        childCount
      }
    }
  }
`)

// ── Derived types ───────────────────────────────────────────────────

export type WatchExperience = NonNullable<
  AdminFragmentOf<typeof adminWatchExperienceFragment>
>

// Blocks appear at multiple nesting levels (top-level, SectionBlock.sectionContent,
// ContainerBlock.content) with different GraphQL unions at each level. This loose
// type covers all levels — renderers narrow via __typename + Record<string, unknown>.
export type AdminBlock = { readonly __typename: string } & Record<
  string,
  unknown
>

export type SearchResult = NonNullable<
  AdminResultOf<typeof SEARCH>["search"]
>["results"][number]

export type SearchResponse = NonNullable<AdminResultOf<typeof SEARCH>["search"]>

// ── Video detail query (standalone, not Experience-bound) ──────────

// Lean by design: the `dubs` selection deliberately OMITS each dub's
// `downloads` + `videoEdition.subtitles`. A video like birth-of-jesus has 2,259
// dubs; projecting their downloads/subtitles here made the payload ~9.5MB and
// the resolver ~13s. The screen only needs one dub's downloads/subtitles (the
// active language), fetched lazily via GET_VIDEO_DUB when the user opens the
// Download/Subtitle sheet or turns captions on. Keep this selection lean.
export const watchVideoFragment = adminGraphql(`
  fragment WatchVideo on Video @_unmask {
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
    primaryLanguage {
      coreId
      bcp47
    }
    locales(locale: $locale) {
      documentId: id
      languageSlug
      title
      description
      snippet
      imageAlt
    }
    parents {
      parent {
        documentId: id
        slug
        label
        locales(locale: $locale) {
          documentId: id
          languageSlug
          title
        }
        images {
          documentId: id
          url
          thumbnail
          mobileCinematicHigh
          mobileCinematicLow
        }
        children {
          child {
            documentId: id
            slug
            label
            locales(locale: $locale) {
              documentId: id
              languageSlug
              title
            }
            images {
              documentId: id
              url
              thumbnail
              mobileCinematicHigh
              mobileCinematicLow
            }
          }
        }
      }
    }
    variants: dubs {
      documentId: id
      slug
      published
      hls
      duration
      language {
        coreId
        bcp47
        slug
        name
      }
      muxVideo {
        playbackId
      }
    }
    studyQuestions {
      documentId: id
      languageSlug
      value: text
      order
    }
    bibleCitations {
      documentId: id
      chapterStart
      chapterEnd
      verseStart
      verseEnd
      order
      osisId
      bibleBook {
        documentId: id
        name
      }
    }
  }
`)

export const GET_VIDEO_BY_SLUG = adminGraphql(
  `
    query GetVideoBySlug($locale: String!, $slug: String!) {
      videoBySlug(slug: $slug) {
        ...WatchVideo
      }
    }
  `,
  [watchVideoFragment],
)

export type WatchVideoData = AdminResultOf<typeof GET_VIDEO_BY_SLUG>

// ── Lean series-screen video fragment ──────────────────────────────
//
// SYNC: mirrors apps/tv/src/lib/videoQueries.ts `seriesWatchVideoFragment`.
//
// A leaner sibling of watchVideoFragment for the SERIES screen, which consumes
// far less of the video than the watch screen. It DELIBERATELY OMITS two heavy
// selections the watch screen needs but the series screen never reads:
//   1. the `parents → parent → children` sibling chain — the series screen
//      renders its episode grid from its OWN `children` (below) and never shows
//      siblings (that's the watch screen's Up Next). On a Jesus-film-sized
//      series the chain is ~208 nodes / ~190KB and ~1.6s of prod resolver time.
//   2. each dub's `duration` + `muxVideo.playbackId` — player-only fields. The
//      series screen needs only a playable `hls` + `language` to pick and swap
//      the trailer; a series carries ~2,270 dubs, so every per-dub field
//      multiplies (bytes + a per-dub muxVideo relation resolution server-side).
// The bulk childDubLanguages aggregation (the largest remaining term) is a
// known-slow admin resolver pending a composite index — see the hand-off note
// in docs/.
export const seriesWatchVideoFragment = adminGraphql(`
  fragment SeriesWatchVideo on Video @_unmask {
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
    primaryLanguage {
      coreId
      bcp47
    }
    locales(locale: $locale) {
      documentId: id
      languageSlug
      title
      description
      snippet
      imageAlt
    }
    variants: dubs {
      documentId: id
      slug
      published
      hls
      language {
        coreId
        bcp47
        slug
        name
      }
    }
    studyQuestions {
      documentId: id
      languageSlug
      value: text
      order
    }
    bibleCitations {
      documentId: id
      chapterStart
      chapterEnd
      verseStart
      verseEnd
      order
      osisId
      bibleBook {
        documentId: id
        name
      }
    }
  }
`)

// ── Series detail query ─────────────────────────────────────────────
//
// A series is a Video whose label is SERIES/COLLECTION (or which has children).
// The series detail page needs two things the single-video query doesn't:
//   1. the series' OWN `children` (the episode grid) — distinct from the
//      `parents.parent.children` siblings (which this query no longer fetches);
//   2. `childDubLanguages` — the server-aggregated union of languages the
//      episodes are available in, which drives the language sheet.
// The series' own `variants`/dubs (a playable one is the trailer) come from the
// lean `seriesWatchVideoFragment` below — NOT the heavier `watchVideoFragment`.
// These series-only selections live HERE, on the operation. gql.tada infers the
// types from admin's introspection; no admin schema change is needed.
export const GET_SERIES_BY_SLUG = adminGraphql(
  `
    query GetSeriesBySlug($locale: String!, $slug: String!) {
      videoBySlug(slug: $slug) {
        ...SeriesWatchVideo
        children {
          order
          child {
            documentId: id
            slug
            label
            locales(locale: $locale) {
              documentId: id
              languageSlug
              title
            }
            images {
              documentId: id
              url
              thumbnail
              mobileCinematicHigh
              mobileCinematicLow
            }
          }
        }
        childDubLanguages {
          slug
          name
          bcp47
        }
      }
    }
  `,
  [seriesWatchVideoFragment],
)

export type SeriesVideoData = AdminResultOf<typeof GET_SERIES_BY_SLUG>

// ── Per-dub media (lazy) ────────────────────────────────────────────
//
// The downloads + subtitles deliberately left out of WatchVideo above. Fetched
// for a single dub on demand (active language only) when the user opens the
// Download/Subtitle sheet or enables captions — so switching language fetches
// just that dub's media, never all ~2,200. The selection MUST mirror the fields
// trimmed from WatchVideo's `dubs` so normalizeDubMedia maps the same shape.
export const watchDubMediaFragment = adminGraphql(`
  fragment WatchDubMedia on VideoDub @_unmask {
    documentId: id
    downloads {
      documentId: id
      quality
      size
      url
    }
    videoEdition {
      subtitles {
        documentId: id
        language {
          slug
          name
          bcp47
        }
        vttSrc
        primary
        aiGenerated
      }
    }
  }
`)

export const GET_VIDEO_DUB = adminGraphql(
  `
    query GetVideoDub($id: ID!) {
      videoDub(id: $id) {
        ...WatchDubMedia
      }
    }
  `,
  [watchDubMediaFragment],
)

export type WatchDubData = AdminResultOf<typeof GET_VIDEO_DUB>

// ── Watch Home bulk query (card-lean by design) ─────────────────────
//
// Adapted from web's WatchHomeVideo fragment (apps/web/src/lib/fragments/
// watch-home.ts) MINUS its `variants: dubs` selection. The home query fetches
// ~30 core IDs in one round trip, and the set includes the JESUS film whose
// ~2,259 dubs re-create the 9.5MB payload incident if projected in bulk
// (KTD-2). Cards need only ids/slug/label/duration/images/locales; the hero
// resolves a playable HLS lazily per slide via GET_VIDEO_BY_SLUG (see
// useHeroStream). NEVER add `dubs` here — watchHomeQueries.test.ts guards it.
// The shape must satisfy WatchHomeVideoInput in src/lib/watchHome/model.ts.
export const watchHomeVideoFragment = adminGraphql(`
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

export const GET_WATCH_HOME_VIDEOS = adminGraphql(
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

export type WatchHomeVideosData = AdminResultOf<typeof GET_WATCH_HOME_VIDEOS>
