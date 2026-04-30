import { graphql } from "@forge/graphql"

// Notes:
// - BibleBook.name is a plain String, NOT a localized {value, primary} pattern
//   like other types — projecting it as the latter breaks codegen.
// - Video.studyQuestions has no `answer` field — see WatchStudyQuestions.
// - parents.children does NOT accept sort:"order:asc" — Video has no `order`
//   field. Children come back in editor-curated relation order.
export const watchVideoFragment = graphql(`
  fragment WatchVideo on Video @_unmask {
    documentId
    slug
    title
    snippet
    description
    noIndex
    label
    imageAlt
    images {
      url
    }
    primaryLanguage {
      coreId
      bcp47
    }
    parents {
      documentId
      slug
      title
      children {
        documentId
        slug
        title
        label
        images {
          url
        }
      }
    }
    variants {
      documentId
      slug
      published
      hls
      language {
        coreId
        bcp47
        slug
        name
      }
      downloads {
        documentId
        quality
        size
        url
      }
      muxVideo {
        playbackId
      }
    }
    studyQuestions(sort: ["order:asc"]) {
      documentId
      value
      order
    }
    bibleCitations(sort: ["order:asc"]) {
      documentId
      chapterStart
      chapterEnd
      verseStart
      verseEnd
      order
      osisId
      bibleBook {
        documentId
        name
      }
    }
  }
`)

// Variant filtering by language is resolver-side, not in the query —
// Strapi returns every variant; the resolver picks via locale priority.
// All variables are required to dodge codegen's optional-stripping bug
// (see docs/solutions/cms/codegen-strips-optional-graphql-variables.md).
export const getWatchVideoOperation = graphql(
  `
    query GetWatchVideo(
      $i18nLocale: I18NLocaleCode!
      $collectionSlug: String!
      $videoSlug: String!
    ) {
      videos(
        filters: {
          slug: { eq: $videoSlug }
          parents: { slug: { eq: $collectionSlug } }
        }
        locale: $i18nLocale
      ) {
        ...WatchVideo
      }
    }
  `,
  [watchVideoFragment],
)

// 2-segment watch route — no collection filter. Resolver picks parents[0]
// as canonical (or null when the video has no parent).
export const getWatchVideoBySlugOperation = graphql(
  `
    query GetWatchVideoBySlug(
      $i18nLocale: I18NLocaleCode!
      $videoSlug: String!
    ) {
      videos(filters: { slug: { eq: $videoSlug } }, locale: $i18nLocale) {
        ...WatchVideo
      }
    }
  `,
  [watchVideoFragment],
)
