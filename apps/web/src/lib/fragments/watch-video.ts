import { adminGraphql } from "@forge/admin-graphql"

/**
 * WatchVideo fragment over admin's `Video` type plus the two query operations
 * that consume it.
 *
 * Field aliases bridge admin's native field names to the watch-page consumer
 * vocabulary that pre-dates this rewrite (e.g. `variants`, `documentId`,
 * `value`):
 *
 *   - `documentId: id` on every node (Video, dub, image, study question,
 *     bible citation, related video). The watch-page client + merge logic
 *     reads `documentId` everywhere; aliasing avoids a cross-cutting
 *     rename. Drop the alias if/when consumers migrate to `id`.
 *   - `variants: dubs` on Video plus aliased fields inside the dub
 *     selection (`documentId: id`). `VideoDub` is admin's rename of the
 *     dub-as-playback concept; web's consumer treats it as the playable
 *     variant and the alias keeps the resolver + UI code stable.
 *   - `value: text` on `VideoStudyQuestion`. The merge layer + question
 *     panel both read `q.value`.
 *
 * Locale-varying fields (`title`, `description`, `snippet`, `imageAlt`)
 * live on `VideoLocale` in admin, not on the parent `Video`. The
 * fragment projects them via `locales(locale: $locale) { ... }`
 * (single-element array per the U6 locale-narrowed read). The resolver
 * flattens the locale row onto the record so consumers keep reading
 * `video.title` etc. directly.
 *
 * `VideoRelation` is admin's join shape for `parents` / `children`. The
 * fragment projects the related Video through `parent { ... }` /
 * `child { ... }` and the resolver flattens those into the
 * Strapi-vocabulary `parents: WatchParent[]` / `children: WatchChild[]`
 * shape the carousel and metadata helpers consume.
 *
 * `BibleBook.name` is `JSON` on admin (legacy compatibility mirror of
 * Core's localised display name). The renderer treats it loosely and the
 * citation card stringifies it; no client-side type narrowing here.
 */
export const watchVideoFragment = adminGraphql(`
  fragment WatchVideo on Video @_unmask {
    documentId: id
    slug
    noIndex
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
    locales(locale: $locale, languageSlug: $languageSlug) {
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
        noIndex
        label
        locales(locale: $locale, languageSlug: $languageSlug) {
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
            locales(locale: $locale, languageSlug: $languageSlug) {
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
    children {
      child {
        documentId: id
        slug
        label
        locales(locale: $locale, languageSlug: $languageSlug) {
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
        # child.dubs is deliberately NOT projected — a 61-chapter ×
        # ~2,200-language fan-out (~45 MB) blows past Next's unstable_cache
        # 2 MB ceiling. Restore the per-chapter duration pill via this cheap
        # server-side scalar (admin's Video.durationSeconds, like
        # HybridSearchResult.durationSeconds), NOT a full dub fetch.
        durationSeconds
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
      downloads {
        documentId: id
        quality
        size
      }
      muxVideo {
        playbackId
      }
      videoEdition {
        subtitles {
          documentId: id
          vttSrc
          srtSrc
          primary
          aiGenerated
          language {
            coreId
            slug
            name
            bcp47
          }
        }
      }
    }
    studyQuestions(locale: $locale, languageSlug: $languageSlug) {
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

// Locale narrowing happens via the `$locale` arg passed to `Video.locales`,
// `VideoRelation.parent.locales`, etc. — admin's U6 widening accepts the arg
// per relation, so the projection only ships the active locale's row in
// each `locales[]` array. Admin's `videoBySlug` resolves the video record
// by slug only; both watch routes (3-segment collection-scoped and
// 2-segment slug-only) share this single operation — the resolver verifies
// the collection-slug match by walking `video.parents` client-side when
// the URL carries a collection segment, otherwise picks `parents[0]` as
// canonical.
export const getWatchVideoBySlugOperation = adminGraphql(
  `
    query GetWatchVideoBySlug(
      $locale: String!
      $languageSlug: String
      $videoSlug: String!
    ) {
      videoBySlug(slug: $videoSlug) {
        ...WatchVideo
      }
    }
  `,
  [watchVideoFragment],
)

// Distinct playable dub languages aggregated across a video's children, one
// representative dub per language. Deliberately NOT part of the WatchVideo
// fragment: only the /series page (SeriesPageClient) consumes it, and on a
// COLLECTION like the Jesus film the union is ~2,200 entries. Folding it into
// the shared fragment would tax every watch-page render — which never reads
// it (the SiblingCarousel shows thumbnails + titles only) — and push the
// unstable_cache value back toward the 2 MB ceiling. resolveSeriesBySlug
// fetches this separately and merges it onto the series record. Admin's
// resolver already collapses the per-child dub fan-out via DISTINCT ON, so
// this stays bounded by the language count, not children × dubs.
export const getVideoChildDubLanguagesBySlugOperation = adminGraphql(`
  query GetVideoChildDubLanguages($videoSlug: String!) {
    videoBySlug(slug: $videoSlug) {
      documentId: id
      childDubLanguages {
        slug
        name
        bcp47
      }
    }
  }
`)
