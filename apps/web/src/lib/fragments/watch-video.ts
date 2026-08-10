import { adminGraphql } from "@forge/admin-graphql"

/**
 * WatchVideo GraphQL operations over admin's `Video` and `VideoDub` types.
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
 * live on `VideoLocale` in admin, not on the parent `Video`. Watch routes
 * fetch the shell plus exact/broad/English copy aliases and one preferred
 * playable dub in `getWatchVideoRouteSnapshotBySlugOperation`, while the
 * split localized-copy operation remains as a small document-level contract
 * test fixture.
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
export const watchVideoShellFragment = adminGraphql(`
  fragment WatchVideoShell on Video @_unmask {
    documentId: id
    slug
    publishedAt
    noIndex
    label
    images {
      documentId: id
      url
      thumbnail
      mobileCinematicHigh
      mobileCinematicLow
      blurDataUrl
      dominantColor
    }
    primaryLanguage {
      coreId
      bcp47
    }
    parents {
      parent {
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
          blurDataUrl
          dominantColor
        }
        children {
          order
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
              blurDataUrl
              dominantColor
            }
          }
        }
      }
    }
    children {
      order
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
          blurDataUrl
          dominantColor
        }
        # child.dubs is deliberately NOT projected — a 61-chapter ×
        # ~2,200-language fan-out (~45 MB) blows past Next's unstable_cache
        # 2 MB ceiling. Restore the per-chapter duration pill via this cheap
        # server-side scalar (admin's Video.durationSeconds), NOT a full dub fetch.
        durationSeconds
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
      passage {
        content
        copyright
        humanReference
        provider
        publisherUrl
        reference
        versionAbbreviation
        versionId
        versionTitle
      }
      bibleBook {
        documentId: id
        name
      }
    }
  }
`)

export const watchVideoLocalizedCopyFragment = adminGraphql(`
  fragment WatchVideoLocalizedCopy on Video @_unmask {
    documentId: id
    locales(locale: $locale, languageSlug: $languageSlug) {
      documentId: id
      languageSlug
      publishedAt
      title
      description
      snippet
      imageAlt
    }
    parents {
      parent {
        documentId: id
        locales(locale: $locale, languageSlug: $languageSlug) {
          documentId: id
          languageSlug
          title
        }
        children {
          order
          child {
            documentId: id
            locales(locale: $locale, languageSlug: $languageSlug) {
              documentId: id
              languageSlug
              title
            }
          }
        }
      }
    }
    children {
      order
      child {
        documentId: id
        locales(locale: $locale, languageSlug: $languageSlug) {
          documentId: id
          languageSlug
          title
        }
      }
    }
    studyQuestions(locale: $locale, languageSlug: $languageSlug) {
      documentId: id
      languageSlug
      value: text
      order
    }
  }
`)

export const watchVideoDubDetailFragment = adminGraphql(`
  fragment WatchVideoDubDetail on VideoDub @_unmask {
    documentId: id
    slug
    published
    hls
    duration
    muxHeroPosterBlurDataUrl
    language {
      coreId
      bcp47
      iso3
      slug
      name
    }
    downloads {
      documentId: id
      height
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
        video {
          documentId: id
        }
        language {
          coreId
          slug
          name
          bcp47
        }
      }
    }
  }
`)

// Admin's `videoBySlug` resolves the video record by slug only; both watch
// routes (3-segment collection-scoped and 2-segment slug-only) share this
// shell operation. Locale copy and selected Dub detail are fetched by the
// dedicated operations below.
export const getWatchVideoShellBySlugOperation = adminGraphql(
  `
    query GetWatchVideoShellBySlug($videoSlug: String!) {
      videoBySlug(slug: $videoSlug) {
        ...WatchVideoShell
      }
    }
  `,
  [watchVideoShellFragment],
)

export const getWatchVideoRouteSnapshotBySlugOperation = adminGraphql(
  `
    query GetWatchVideoRouteSnapshotBySlug(
      $locale: String!
      $languageSlug: String
      $subtitleLanguageSlug: String
      $videoSlug: String!
    ) {
      watchVideoRouteSnapshotBySlug(
        slug: $videoSlug
        locale: $locale
        languageSlug: $languageSlug
        subtitleLanguageSlug: $subtitleLanguageSlug
      ) {
        documentId
        slug
        publishedAt
        noIndex
        label
        images {
          documentId
          url
          thumbnail
          mobileCinematicHigh
          mobileCinematicLow
        }
        primaryLanguage {
          coreId
          bcp47
        }
        parents {
          parent {
            documentId
            slug
            noIndex
            label
            images {
              documentId
              url
              thumbnail
              mobileCinematicHigh
              mobileCinematicLow
            }
            exactLocales {
              documentId
              languageSlug
              title
            }
            broadLocales {
              documentId
              languageSlug
              title
            }
            englishLocales {
              documentId
              languageSlug
              title
            }
            children {
              order
              child {
                documentId
                slug
                label
                muxPlaybackId
                muxThumbnailBlurDataUrl
                muxHeroPosterBlurDataUrl
                images {
                  documentId
                  url
                  thumbnail
                  mobileCinematicHigh
                  mobileCinematicLow
                }
                exactLocales {
                  documentId
                  languageSlug
                  title
                }
                broadLocales {
                  documentId
                  languageSlug
                  title
                }
                englishLocales {
                  documentId
                  languageSlug
                  title
                }
              }
            }
          }
        }
        children {
          order
          child {
            documentId
            slug
            label
            muxPlaybackId
            muxThumbnailBlurDataUrl
            muxHeroPosterBlurDataUrl
            durationSeconds
            images {
              documentId
              url
              thumbnail
              mobileCinematicHigh
              mobileCinematicLow
            }
            exactLocales {
              documentId
              languageSlug
              title
            }
            broadLocales {
              documentId
              languageSlug
              title
            }
            englishLocales {
              documentId
              languageSlug
              title
            }
          }
        }
        bibleCitations {
          documentId
          chapterStart
          chapterEnd
          verseStart
          verseEnd
          order
          osisId
          passage(languageSlug: $languageSlug) {
            content
            copyright
            humanReference
            provider
            publisherUrl
            reference
            versionAbbreviation
            versionId
            versionTitle
          }
          bibleBook {
            documentId
            name
          }
        }
        exactLocales {
          documentId
          languageSlug
          publishedAt
          title
          description
          snippet
          imageAlt
          searchTitle
          searchDescription
          socialImage {
            url
            width
            height
            mimeType
          }
        }
        broadLocales {
          documentId
          languageSlug
          publishedAt
          title
          description
          snippet
          imageAlt
          searchTitle
          searchDescription
          socialImage {
            url
            width
            height
            mimeType
          }
        }
        englishLocales {
          documentId
          languageSlug
          publishedAt
          title
          description
          snippet
          imageAlt
          searchTitle
          searchDescription
          socialImage {
            url
            width
            height
            mimeType
          }
        }
        exactStudyQuestions {
          documentId
          languageSlug
          value
          order
        }
        broadStudyQuestions {
          documentId
          languageSlug
          value
          order
        }
        englishStudyQuestions {
          documentId
          languageSlug
          value
          order
        }
        playableDubLanguageCount
        preferredVariant {
          documentId
          slug
          published
          hls
          duration
          muxHeroPosterBlurDataUrl
          language {
            coreId
            bcp47
            slug
            name
          }
        }
      }
    }
  `,
)

export const getWatchLanguagePickerVariantsBySlugOperation = adminGraphql(`
  query GetWatchLanguagePickerVariantsBySlug($videoSlug: String!) {
    videoBySlug(slug: $videoSlug) {
      documentId: id
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
      }
    }
  }
`)

export const getWatchVideoCarouselMuxPlaybackIdsBySlugOperation = adminGraphql(`
  query GetWatchVideoCarouselMuxPlaybackIds(
    $languageSlug: String
    $videoSlug: String!
  ) {
    videoBySlug(slug: $videoSlug) {
      documentId: id
      parents {
        parent {
          documentId: id
          children {
            child {
              documentId: id
              muxPlaybackId(languageSlug: $languageSlug)
              muxThumbnailBlurDataUrl(languageSlug: $languageSlug)
              muxHeroPosterBlurDataUrl(languageSlug: $languageSlug)
            }
          }
        }
      }
      children {
        child {
          documentId: id
          muxPlaybackId(languageSlug: $languageSlug)
          muxThumbnailBlurDataUrl(languageSlug: $languageSlug)
          muxHeroPosterBlurDataUrl(languageSlug: $languageSlug)
        }
      }
    }
  }
`)

export const getWatchVideoLocalizedCopyBySlugOperation = adminGraphql(
  `
    query GetWatchVideoLocalizedCopyBySlug(
      $locale: String!
      $languageSlug: String
      $videoSlug: String!
    ) {
      videoBySlug(slug: $videoSlug) {
        ...WatchVideoLocalizedCopy
      }
    }
  `,
  [watchVideoLocalizedCopyFragment],
)

export const getWatchVideoDubDetailOperation = adminGraphql(
  `
    query GetWatchVideoDubDetail($id: ID!) {
      videoDub(id: $id) {
        ...WatchVideoDubDetail
      }
    }
  `,
  [watchVideoDubDetailFragment],
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

export const getWatchCollectionDownloadDubsBySlugOperation = adminGraphql(`
  query GetWatchCollectionDownloadDubs(
    $videoSlug: String!
    $languageSlug: String!
  ) {
    videoBySlug(slug: $videoSlug) {
      documentId: id
      downloadableChildDubs(languageSlug: $languageSlug) {
        documentId: id
        videoId
        downloads {
          documentId: id
          height
          quality
          size
          url
        }
      }
    }
  }
`)
