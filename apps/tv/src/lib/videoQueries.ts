// TV-side video-detail GraphQL operations, kept field-for-field in sync with
// apps/mobile/src/lib/queries.ts. Split (lean bulk video + dub list, lazy per-dub
// media) is the proven mobile pattern; do NOT inline downloads/subtitles.
import {
  adminGraphql as graphql,
  type AdminResultOf as ResultOf,
} from "@forge/admin-graphql"

// ── Bulk video fragment (lean) ──────────────────────────────────────
// `variants: dubs` deliberately OMITS each dub's downloads + subtitles: at 2,259
// dubs (birth-of-jesus) projecting them made the payload ~9.5MB / resolver ~13s.
// Only the active language's media is needed, fetched lazily via GET_VIDEO_DUB.
export const watchVideoFragment = graphql(`
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
            muxPlaybackId
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

// Own `children` = this video's chapter clips (JESUS 61), the Chapters rail. On
// the QUERY not the fragment, field-for-field with GET_SERIES_BY_SLUG's children
// so the shared buildChildren normalizes both (NormalizableChildRel enforces it).
export const GET_VIDEO_BY_SLUG = graphql(
  `
    query GetVideoBySlug($locale: String!, $slug: String!) {
      videoBySlug(slug: $slug) {
        ...WatchVideo
        children {
          order
          child {
            documentId: id
            slug
            label
            muxPlaybackId
            locales(locale: $locale) {
              documentId: id
              languageSlug
              title
              description
              imageAlt
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
  `,
  [watchVideoFragment],
)

export type WatchVideoData = ResultOf<typeof GET_VIDEO_BY_SLUG>

// ── Lean series-screen video fragment ──────────────────────────────
// SYNC: mirrors apps/mobile/src/lib/queries.ts `seriesWatchVideoFragment`. Omits vs
// watchVideoFragment the `parents → parent → children` chain (~208 nodes/~1.6s) + each
// dub's `duration`/`muxVideo.playbackId`; childDubLanguages awaits a composite index (docs/).
export const seriesWatchVideoFragment = graphql(`
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
// SYNC: mirrors apps/mobile/src/lib/queries.ts GET_SERIES_BY_SLUG, plus the OWN
// `children` (episode rail). The childDubLanguages union — the ~835KB server
// aggregation — is split into GET_SERIES_LANGUAGES below so the hero + rail paint
// without waiting on it. Children select card fields only, never dubs/variants.
export const GET_SERIES_BY_SLUG = graphql(
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
            muxPlaybackId
            locales(locale: $locale) {
              documentId: id
              languageSlug
              title
              description
              imageAlt
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
  `,
  [seriesWatchVideoFragment],
)

export type SeriesVideoData = ResultOf<typeof GET_SERIES_BY_SLUG>

// ── Series language union (lazy, secondary) ─────────────────────────
// childDubLanguages alone, fetched after the lean GET_SERIES_BY_SLUG so the hero
// and rail render first; feeds the panel + count from its OWN state, never the
// lean record (KTD1 keeps the lean read stable so the dub memo never re-walks).
export const GET_SERIES_LANGUAGES = graphql(`
  query GetSeriesLanguages($slug: String!) {
    videoBySlug(slug: $slug) {
      documentId: id
      childDubLanguages {
        slug
        name
        bcp47
      }
    }
  }
`)

export type SeriesLanguagesData = ResultOf<typeof GET_SERIES_LANGUAGES>

// ── Per-dub media (lazy) ────────────────────────────────────────────
// The downloads + subtitles left out of WatchVideo, fetched per dub on demand
// (active language only) so switching fetches just that dub, never all ~2,200. MUST
// mirror the fields trimmed from WatchVideo's `dubs` so normalizeDubMedia maps it.
export const watchDubMediaFragment = graphql(`
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

export const GET_VIDEO_DUB = graphql(
  `
    query GetVideoDub($id: ID!) {
      videoDub(id: $id) {
        ...WatchDubMedia
      }
    }
  `,
  [watchDubMediaFragment],
)

export type WatchDubData = ResultOf<typeof GET_VIDEO_DUB>
