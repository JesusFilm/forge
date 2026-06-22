// TV-side video-detail GraphQL operations. Kept field-for-field in sync with
// apps/mobile/src/lib/queries.ts. The split (lean bulk video + dub list, lazy
// per-dub media) is the proven mobile pattern; do NOT inline downloads/subtitles
// into the bulk fragment (see the payload note below). @_unmask exposes fragment
// fields directly on parent results.
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

export const GET_VIDEO_BY_SLUG = graphql(
  `
    query GetVideoBySlug($locale: String!, $slug: String!) {
      videoBySlug(slug: $slug) {
        ...WatchVideo
      }
    }
  `,
  [watchVideoFragment],
)

export type WatchVideoData = ResultOf<typeof GET_VIDEO_BY_SLUG>

// ── Lean series-screen video fragment ──────────────────────────────
// SYNC: mirrors apps/mobile/src/lib/queries.ts `seriesWatchVideoFragment`. Leaner
// than watchVideoFragment: OMITS the `parents → parent → children` sibling chain
// (~208 nodes/~1.6s; series uses its OWN `children`) and each dub's `duration` +
// `muxVideo.playbackId` (player-only, multiplied across ~2,270 dubs). The bulk
// childDubLanguages aggregation is a known-slow admin resolver pending a
// composite index — see the hand-off note in docs/.
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
// SYNC: mirrors apps/mobile/src/lib/queries.ts GET_SERIES_BY_SLUG. Adds two
// series-only selections atop the lean fragment (NOT watchVideoFragment): the
// series' OWN `children` (episode rail) and `childDubLanguages` (language panel).
// Children select card fields only, never dubs/variants — a 61-chapter ×
// ~2,200-dub collection is the 9.5MB incident again.
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

export type SeriesVideoData = ResultOf<typeof GET_SERIES_BY_SLUG>

// ── Per-dub media (lazy) ────────────────────────────────────────────
// The downloads + subtitles left out of WatchVideo, fetched per dub on demand
// (active language only) so switching language fetches just that dub, never all
// ~2,200. MUST mirror the fields trimmed from WatchVideo's `dubs` so
// normalizeDubMedia maps the same shape.
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
