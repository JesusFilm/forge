// Watch Home bulk query (card-lean); keep in sync with mobile's GET_WATCH_HOME_VIDEOS.
// NEVER add `dubs` — JESUS's ~2,259 dubs = the 9.5MB payload incident; homeQueries.test.ts
// guards it. Streams resolve lazily per slug (GET_VIDEO_BY_SLUG, videoQueries.ts).
import {
  adminGraphql as graphql,
  type AdminResultOf as ResultOf,
} from "@forge/admin-graphql"
import { adminWatchExperienceFragment } from "@forge/admin-graphql/fragments"

export const watchHomeVideoFragment = graphql(`
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
    englishTitleLocales: locales(locale: "en") {
      title
    }
    englishLanguageTitleLocales: locales(languageSlug: "english") {
      title
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
        englishTitleLocales: locales(locale: "en") {
          title
        }
        englishLanguageTitleLocales: locales(languageSlug: "english") {
          title
        }
      }
    }
  }
`)

export const GET_WATCH_HOME_VIDEOS = graphql(
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

export type WatchHomeVideosData = ResultOf<typeof GET_WATCH_HOME_VIDEOS>

// Public home-setting query — the single admin `watch-home` Experience web and
// mobile already render (R1). Consumes the SHARED AdminWatchExperience fragment
// (now carrying item `coreId`, R17). Uses only `watchSetting` (public); never the
// editor-gated `experiences` list (R13/AE12 — guarded in homeQueries.test.ts).
export const GET_WATCH_SETTING = graphql(
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

export type WatchSettingData = ResultOf<typeof GET_WATCH_SETTING>
