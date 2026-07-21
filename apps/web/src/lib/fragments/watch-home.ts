import { adminGraphql } from "@forge/admin-graphql"

export const watchHomeVideoFragment = adminGraphql(`
  fragment WatchHomeVideo on Video @_unmask {
    documentId: id
    coreId
    slug
    label
    durationSeconds
    primaryLanguage {
      coreId
      bcp47
      slug
    }
    images {
      documentId: id
      url
      thumbnail
      mobileCinematicHigh
      mobileCinematicLow
      videoStill
      blurDataUrl
      dominantColor
    }
    locales(locale: $locale, languageSlug: $languageSlug) {
      documentId: id
      languageSlug
      title
      description
      snippet
      imageAlt
    }
    preferredVariant: preferredPlayableDub(languageSlug: $languageSlug) {
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
      videoEdition {
        subtitles {
          vttSrc
          primary
          language {
            bcp47
            slug
          }
        }
      }
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
          blurDataUrl
          dominantColor
        }
        locales(locale: $locale, languageSlug: $languageSlug) {
          documentId: id
          languageSlug
          title
          description
          snippet
          imageAlt
        }
        preferredVariant: preferredPlayableDub(languageSlug: $languageSlug) {
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
          videoEdition {
            subtitles {
              vttSrc
              primary
              language {
                bcp47
                slug
              }
            }
          }
        }
      }
    }
  }
`)

export const getWatchHomeVideosOperation = adminGraphql(
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
