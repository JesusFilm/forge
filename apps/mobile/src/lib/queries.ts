/**
 * Admin GraphQL operations for Experience blocks and search, via adminGraphql()
 * with the shared AdminWatchExperience fragment composing all block fragments.
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

// ── Watch search query ──────────────────────────────────────────────

// Admin retired the legacy `Query.search` in #1622; `watchSearch` is the
// multilingual replacement. Selection stays narrow — mobile renders a card grid,
// so the language/evidence/availability signals web uses are deliberately unread.
export const WATCH_SEARCH = adminGraphql(`
  query WatchSearch($input: WatchSearchInput!) {
    watchSearch(input: $input) {
      query
      hasMore
      nextOffset
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

/** Whole watchSearch envelope as admin returns it; `undefined` when absent. */
export type WatchSearchWire =
  | AdminResultOf<typeof WATCH_SEARCH>["watchSearch"]
  | undefined

/** One row exactly as admin returns it — every field nullable. */
export type WatchSearchResultItem = NonNullable<
  NonNullable<AdminResultOf<typeof WATCH_SEARCH>["watchSearch"]>["results"]
>[number]

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

// UI-facing row: narrowed to non-null so cards and routing can read slug/title
// without guards. `mapWatchSearchResult` drops server rows missing any of them.
export type SearchResult = {
  readonly type: string
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly imageUrl: string | null
  readonly snippet: string | null
  readonly startSeconds: number | null
  readonly playbackId: string | null
  readonly score: number | null
  readonly label: string | null
  readonly childCount: number | null
}

export type SearchResponse = {
  readonly query: string
  readonly hasMore: boolean
  /** Offset to request for the next page; admin owns the cursor arithmetic. */
  readonly nextOffset: number
  readonly results: readonly SearchResult[]
}

// ── Video detail query (standalone, not Experience-bound) ──────────

// Lean by design: `dubs` OMITS each dub's `downloads` + `videoEdition.subtitles`
// (birth-of-jesus has 2,259 dubs → ~9.5MB / ~13s if projected). The active
// language's media is fetched lazily via GET_VIDEO_DUB; keep this selection lean.
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
      videoStill
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
          videoStill
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
              videoStill
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
// SYNC: mirrors apps/tv/src/lib/videoQueries.ts `seriesWatchVideoFragment`. Leaner sibling of watchVideoFragment;
// OMITS the `parents→parent→children` sibling chain (grid uses OWN `children`) + each dub's `duration`/`muxVideo.playbackId`.
// childDubLanguages: slow admin resolver pending a composite index (hand-off note in docs/).
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
      videoStill
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
// Adds over the single-video query: the series' OWN `children` (episode grid, distinct
// from `parents.parent.children` siblings) + `childDubLanguages` (aggregated episode-language
// union driving the sheet). Uses lean `seriesWatchVideoFragment`, NOT `watchVideoFragment`.
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
            durationSeconds
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
              videoStill
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
// The downloads + subtitles left out of WatchVideo, fetched per-dub on demand
// (active language only) so switching never pulls all ~2,200. Selection MUST
// mirror the fields trimmed from WatchVideo's `dubs` so normalizeDubMedia maps it.
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

// Series-download resolution probe: ONLY the dub id/language index. The full
// GET_VIDEO_BY_SLUG payload on 2000+-dub segments made 61-episode resolution
// take minutes and blow the per-episode timeout; this keeps it to a few KB.
export const GET_VIDEO_DUB_INDEX = adminGraphql(`
  query GetVideoDubIndex($slug: String!) {
    videoBySlug(slug: $slug) {
      documentId: id
      variants: dubs {
        documentId: id
        published
        language {
          slug
        }
      }
    }
  }
`)

export type WatchDubIndexData = AdminResultOf<typeof GET_VIDEO_DUB_INDEX>

// ── Watch Home bulk query (card-lean by design) ─────────────────────
// Web's WatchHomeVideo fragment MINUS `variants: dubs`: the ~30-id bulk fetch includes the JESUS film whose
// ~2,259 dubs re-create the 9.5MB incident (KTD-2). Hero resolves HLS lazily (useHeroStream). NEVER add `dubs`
// — watchHomeQueries.test.ts guards it; shape must satisfy WatchHomeVideoInput in src/lib/watchHome/model.ts.
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
