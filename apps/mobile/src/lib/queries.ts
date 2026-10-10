/**
 * Admin GraphQL operations for Experience blocks and search, via adminGraphql()
 * with the rollout-safe AdminLegacyWatchExperience fragment. Mobile does not
 * render the Web-only category rail, so its operation stays valid across an
 * Admin rollback while that compatibility window remains open.
 */
import {
  adminGraphql,
  type AdminFragmentOf,
  type AdminResultOf,
} from "@forge/admin-graphql"
import { adminLegacyWatchExperienceFragment } from "@forge/admin-graphql/fragments"

// ── Experience queries ──────────────────────────────────────────────

// KTD10: the catalog-tag Experience and the `en` one in ONE request, because
// Admin holds Experiences for only a few locales. `$isEnglish` skips the
// duplicate when the catalog tag is already `en` (localeQueryVariables).
export const GET_EXPERIENCE_BY_SLUG = adminGraphql(
  `
    query GetExperienceBySlug(
      $locale: String!
      $slug: String!
      $isEnglish: Boolean!
    ) {
      experienceBySlug(locale: $locale, slug: $slug) {
        ...AdminLegacyWatchExperience
      }
      englishExperience: experienceBySlug(locale: "en", slug: $slug)
        @skip(if: $isEnglish) {
        ...AdminLegacyWatchExperience
      }
    }
  `,
  [adminLegacyWatchExperienceFragment],
)

// KTD10 and R11: the homepage in the catalog tag and in `en`, in one request.
export const GET_WATCH_SETTING = adminGraphql(
  `
    query GetWatchSetting($locale: String!, $isEnglish: Boolean!) {
      watchSetting(locale: $locale) {
        documentId
        homepageExperience {
          ...AdminLegacyWatchExperience
        }
      }
      englishWatchSetting: watchSetting(locale: "en") @skip(if: $isEnglish) {
        documentId
        homepageExperience {
          ...AdminLegacyWatchExperience
        }
      }
    }
  `,
  [adminLegacyWatchExperienceFragment],
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
      requestId
      latencyMs
      degraded
      searchMode
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
        durationSeconds
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

// ── Watch search event mutation ─────────────────────────────────────

/** Pinned by apolloClient's error-link exemption (KTD6) and the U7 guard test. */
export const WATCH_SEARCH_EVENT_OPERATION_NAME = "RecordWatchSearchEvent"

// Mirrors web's operation (search-actions.ts) MINUS $occurredAt: admin rejects
// stamps >24h past / >5min future, so a skew-clocked device would silently lose
// every event. Admin stamps its own clock; web's runs on a server clock.
export const RECORD_WATCH_SEARCH_EVENT = adminGraphql(`
  mutation RecordWatchSearchEvent(
    $requestId: String!
    $eventType: WatchSearchEventType!
    $client: WatchSearchEventClient!
    $resultId: ID
    $resultType: WatchSearchEventResultType
    $position: Int
    $visibleResultIds: [String!]
    $routeLanguageSlug: String
    $searchLanguageSlug: String
  ) {
    recordWatchSearchEvent(
      requestId: $requestId
      eventType: $eventType
      client: $client
      resultId: $resultId
      resultType: $resultType
      position: $position
      visibleResultIds: $visibleResultIds
      routeLanguageSlug: $routeLanguageSlug
      searchLanguageSlug: $searchLanguageSlug
    ) {
      id
    }
  }
`)

// ── Derived types ───────────────────────────────────────────────────

export type WatchExperience = NonNullable<
  AdminFragmentOf<typeof adminLegacyWatchExperienceFragment>
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
  /** Leaf videos carry this; a series/collection carries childCount instead. */
  readonly durationSeconds: number | null
}

export type SearchResponse = {
  readonly query: string
  readonly hasMore: boolean
  /** Offset to request for the next page; admin owns the cursor arithmetic. */
  readonly nextOffset: number
  readonly results: readonly SearchResult[]
  /** Admin's echoed correlation id; joins client telemetry to the server trace. */
  readonly requestId: string | null
  /** Server-side latency as admin measured it, distinct from client wall time. */
  readonly latencyMs: number | null
  readonly degraded: boolean | null
  readonly searchMode: string | null
}

// ── Video text (KTD10) ──────────────────────────────────────────────
// The ONE spelling of a `locales(...)` argument set: every document spreads
// these fragments, so Home's rows are a cache hit for a watch title.
export const videoTextFragment = adminGraphql(`
  fragment VideoText on Video @_unmask {
    locales(languageSlug: $textSlug) {
      documentId: id
      languageSlug
      title
      description
      snippet
      imageAlt
    }
    englishLocales: locales(languageSlug: "english") {
      documentId: id
      languageSlug
      title
      description
      snippet
      imageAlt
    }
  }
`)

/** Titles only, for relatives: parents, siblings, and episodes. */
export const videoTitleTextFragment = adminGraphql(`
  fragment VideoTitleText on Video @_unmask {
    locales(languageSlug: $textSlug) {
      documentId: id
      languageSlug
      title
    }
    englishLocales: locales(languageSlug: "english") {
      documentId: id
      languageSlug
      title
    }
  }
`)

// ── Video detail query (standalone, not Experience-bound) ──────────

// Lean and language-free (KTD10): `dubs` omits each dub's downloads + subtitles
// (birth-of-jesus: 2,259 dubs, ~9.5MB), fetched lazily via GET_VIDEO_DUB, and the
// text comes from GET_VIDEO_TEXT, so a UI language change never refetches this.
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
    parents {
      parent {
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
        children {
          child {
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
        iso3
      }
      muxVideo {
        playbackId
      }
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
        osisId
        paratextAbbreviation
      }
    }
  }
`)

export const GET_VIDEO_BY_SLUG = adminGraphql(
  `
    query GetVideoBySlug($slug: String!) {
      videoBySlug(slug: $slug) {
        ...WatchVideo
      }
    }
  `,
  [watchVideoFragment],
)

export type WatchVideoData = AdminResultOf<typeof GET_VIDEO_BY_SLUG>

// ── Video text companion (KTD10) ────────────────────────────────────
// `documentId: id` at every level lets this write normalize onto the player
// read's Video entities; the relation shapes mirror WatchVideo exactly.
export const GET_VIDEO_TEXT = adminGraphql(
  `
    query GetVideoText($slug: String!, $textSlug: String!) {
      videoBySlug(slug: $slug) {
        documentId: id
        ...VideoText
        studyQuestions(languageSlug: $textSlug) {
          documentId: id
          languageSlug
          value: text
          order
        }
        englishStudyQuestions: studyQuestions(languageSlug: "english") {
          documentId: id
          languageSlug
          value: text
          order
        }
        parents {
          parent {
            documentId: id
            ...VideoTitleText
            children {
              child {
                documentId: id
                ...VideoTitleText
              }
            }
          }
        }
      }
    }
  `,
  [videoTextFragment, videoTitleTextFragment],
)

export type VideoTextData = AdminResultOf<typeof GET_VIDEO_TEXT>

// ── Bible passage companion query ──────────────────────────────────
// KTD1: `passage` stays OUT of watchVideoFragment. Five call sites execute that
// fragment (watch screen, home hero + its prefetch, search prefetch, per-episode
// subtitle fan-out) and only the watch screen renders a Bible card, so a
// selection there taxes every one of them with an uncached provider round trip.
//
// KTD2: `documentId: id` on `videoBySlug` ITSELF is load-bearing, not decoration.
// Without it this write cannot normalize the video, so it replaces the shared
// reference with a plain object and the player-gating read collapses — silently,
// because a SUCCESSFUL passage read is what triggers it.
export const GET_VIDEO_BIBLE_PASSAGES = adminGraphql(`
  query GetVideoBiblePassages(
    $slug: String!
    $textSlug: String!
    $isEnglish: Boolean!
  ) {
    videoBySlug(slug: $slug) {
      documentId: id
      bibleCitations {
        documentId: id
        passage(languageSlug: $textSlug) {
          content
          copyright
          humanReference
          provider
          reference
          versionAbbreviation
          versionId
          versionTitle
        }
        englishPassage: passage(languageSlug: "english")
          @skip(if: $isEnglish) {
          content
          copyright
          humanReference
          provider
          reference
          versionAbbreviation
          versionId
          versionTitle
        }
      }
    }
  }
`)

export type VideoBiblePassagesData = AdminResultOf<
  typeof GET_VIDEO_BIBLE_PASSAGES
>

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
    query GetSeriesBySlug($slug: String!) {
      videoBySlug(slug: $slug) {
        ...SeriesWatchVideo
        children {
          order
          child {
            documentId: id
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

// ── Series text companion (KTD10) ───────────────────────────────────
// Mirrors GET_SERIES_BY_SLUG's `children { order child }`: a `children { child }`
// write would replace that list and drop `order` from the episode grid's read.
export const GET_SERIES_TEXT = adminGraphql(
  `
    query GetSeriesText($slug: String!, $textSlug: String!) {
      videoBySlug(slug: $slug) {
        documentId: id
        ...VideoText
        children {
          order
          child {
            documentId: id
            ...VideoTitleText
          }
        }
      }
    }
  `,
  [videoTextFragment, videoTitleTextFragment],
)

export type SeriesTextData = AdminResultOf<typeof GET_SERIES_TEXT>

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
// The text rows come from the shared VideoText fragment (KTD10), so a watch
// screen opened from Home reads its title from this write.
export const watchHomeVideoFragment = adminGraphql(
  `
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
      ...VideoText
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
          ...VideoText
        }
      }
    }
  `,
  [videoTextFragment],
)

export const GET_WATCH_HOME_VIDEOS = adminGraphql(
  `
    query GetWatchHomeVideos($coreIds: [String!]!, $textSlug: String!) {
      watchHomeVideos(coreIds: $coreIds) {
        ...WatchHomeVideo
      }
    }
  `,
  [watchHomeVideoFragment],
)

export type WatchHomeVideosData = AdminResultOf<typeof GET_WATCH_HOME_VIDEOS>

// ── Experience card art and titles (useVideoThumbnails) ─────────────
// Batched as aliased `video(id:)` fields with the ids as variables. Any
// selection of `images` selects `videoStill` too (pickCardImage).
export const videoThumbnailFragment = adminGraphql(
  `
    fragment VideoThumbnail on Video @_unmask {
      documentId: id
      images {
        documentId: id
        mobileCinematicHigh
        mobileCinematicLow
        videoStill
        thumbnail
        url
      }
      ...VideoTitleText
    }
  `,
  [videoTitleTextFragment],
)

export type VideoThumbnailData = AdminResultOf<typeof videoThumbnailFragment>

// ── Explore clips feed (feat-552 KTD6) ─────────────────────────────
// Both operations run with fetchPolicy "no-cache", so a long session builds
// nothing up in the shared Apollo cache.

// The lean pool. U1: English at limit 1,000 is 665 KB decoded with these
// fields; `imageUrl` would add 20%, so the veil's authored image comes from
// the hydration below instead.
export const exploreInventoryItemFragment = adminGraphql(`
  fragment ExploreInventoryItem on WatchLanguageInventoryItem @_unmask {
    id
    coreId
    slug
    label
    availability
    durationSeconds
    muxPlaybackId
    watchLanguageSlug
    title
    description
  }
`)

export const EXPLORE_INVENTORY = adminGraphql(
  `
    query ExploreInventory($languageSlug: String!, $limit: Int) {
      watchLanguageInventory(languageSlug: $languageSlug, limit: $limit) {
        language {
          slug
          name
        }
        audioCollections {
          ...ExploreInventoryItem
        }
        audioVideos {
          ...ExploreInventoryItem
        }
        subtitleOnlyVideos {
          ...ExploreInventoryItem
        }
      }
    }
  `,
  [exploreInventoryItemFragment],
)

export type ExploreInventoryData = AdminResultOf<typeof EXPLORE_INVENTORY>

// Up to three queued candidates of one audio language in ONE root-field access
// (admin allows 60 per minute, one per alias). The dub can be in another
// language, so the caller checks its slug. NEVER add `dubs`; no bare `url`.
export const EXPLORE_CLIP_CANDIDATES = adminGraphql(
  `
  query ExploreClipCandidates(
    $coreIds: [String!]!
    $audioLanguageSlug: String!
    $textSlug: String!
  ) {
    watchHomeVideos(coreIds: $coreIds) {
      documentId: id
      coreId
      ...VideoText
      images {
        documentId: id
        thumbnail
        mobileCinematicHigh
        mobileCinematicLow
        videoStill
      }
      preferredPlayableDub(languageSlug: $audioLanguageSlug) {
        documentId: id
        hls
        duration
        lengthInMilliseconds
        language {
          slug
        }
        muxVideo {
          playbackId
        }
        videoEdition {
          documentId: id
          subtitles {
            documentId: id
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
  }
`,
  [videoTextFragment],
)

export type ExploreClipCandidatesData = AdminResultOf<
  typeof EXPLORE_CLIP_CANDIDATES
>
