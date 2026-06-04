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
