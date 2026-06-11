// TV-side video-detail GraphQL operations.
//
// Kept field-for-field in sync with apps/mobile/src/lib/queries.ts
// (`watchVideoFragment` / GET_VIDEO_BY_SLUG and `watchDubMediaFragment` /
// GET_VIDEO_DUB). The split — lean bulk video + dub list, lazy per-dub media —
// is the proven mobile pattern; do not inline downloads/subtitles into the
// bulk fragment (see the payload note below).
//
// Defined here in apps/tv/ per convention:
// "Operations are defined in apps using graphql() from this package."
//
// Uses @_unmask to make fragment fields directly accessible on parent results.
import {
  adminGraphql as graphql,
  type AdminResultOf as ResultOf,
} from "@forge/admin-graphql"

// ── Bulk video fragment (lean) ──────────────────────────────────────
//
// Lean by design: the `variants: dubs` selection deliberately OMITS each dub's
// `downloads` + `videoEdition.subtitles`. A video like birth-of-jesus has 2,259
// dubs; projecting their downloads/subtitles here made the payload ~9.5MB and
// the resolver ~13s. The screen only needs one dub's downloads/subtitles (the
// active language), fetched lazily via GET_VIDEO_DUB when the user opens the
// Download/Subtitle panel or turns captions on. Keep this selection lean.
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

// ── Series detail query ─────────────────────────────────────────────
//
// SYNC: mirrors apps/mobile/src/lib/queries.ts GET_SERIES_BY_SLUG.
//
// A series is a Video whose label is SERIES/COLLECTION (or which has children).
// The series screen needs two things the single-video query doesn't:
//   1. the series' OWN `children` (the episode rail) — distinct from the
//      `parents.parent.children` siblings the WatchVideo fragment carries;
//   2. `childDubLanguages` — the server-aggregated union of languages the
//      episodes are available in, which feeds the language panel.
// These series-only selections live HERE, on a dedicated operation, NOT on the
// shared `watchVideoFragment` — keeping the single-video query lean (see the
// payload note above). Children select card fields only, never dubs/variants:
// a Jesus-film-sized collection (61 chapters × ~2,200 dubs) is the 9.5MB
// incident again.
export const GET_SERIES_BY_SLUG = graphql(
  `
    query GetSeriesBySlug($locale: String!, $slug: String!) {
      videoBySlug(slug: $slug) {
        ...WatchVideo
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
  [watchVideoFragment],
)

export type SeriesVideoData = ResultOf<typeof GET_SERIES_BY_SLUG>

// ── Per-dub media (lazy) ────────────────────────────────────────────
//
// The downloads + subtitles deliberately left out of WatchVideo above. Fetched
// for a single dub on demand (active language only) when the user opens the
// Download/Subtitle panel or enables captions — so switching language fetches
// just that dub's media, never all ~2,200. The selection MUST mirror the fields
// trimmed from WatchVideo's `dubs` so normalizeDubMedia maps the same shape.
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
