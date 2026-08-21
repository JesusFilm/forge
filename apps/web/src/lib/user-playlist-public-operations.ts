import { adminGraphql } from "@forge/admin-graphql"

export const PUBLIC_USER_PLAYLIST_QUERY_SOURCE = `
  query PublicUserPlaylist($token: String!) {
    userPlaylistByToken(token: $token) {
      title
      description
      locale
      countryCode
      reportIntent
      blocks {
        __typename
        ... on UserPlaylistTextBlock {
          text
        }
        ... on UserPlaylistMediaCollectionBlock {
          title
          items {
            videoId
          }
        }
        ... on UserPlaylistVideoCarouselBlock {
          title
          items {
            videoId
          }
        }
      }
    }
  }
` as const

export const publicUserPlaylistOperation = adminGraphql(
  PUBLIC_USER_PLAYLIST_QUERY_SOURCE,
)

export const PUBLIC_USER_PLAYLIST_VIDEOS_QUERY_SOURCE = `
  fragment PublicUserPlaylistVideoCard on Video @_unmask {
    id
    slug
    durationSeconds
    noIndex
    images {
      url
      thumbnail
      mobileCinematicHigh
      mobileCinematicLow
      videoStill
      blurDataUrl
    }
    locales(locale: $locale, languageSlug: $languageSlug) {
      title
      imageAlt
    }
    preferredPlayableDub(languageSlug: $languageSlug) {
      hls
      duration
      language {
        slug
      }
    }
  }

  query PublicUserPlaylistVideos(
    $id0: ID!
    $id1: ID!
    $id2: ID!
    $id3: ID!
    $id4: ID!
    $id5: ID!
    $id6: ID!
    $id7: ID!
    $id8: ID!
    $id9: ID!
    $id10: ID!
    $id11: ID!
    $id12: ID!
    $id13: ID!
    $id14: ID!
    $id15: ID!
    $id16: ID!
    $id17: ID!
    $id18: ID!
    $id19: ID!
    $locale: String!
    $languageSlug: String
  ) {
    video0: video(id: $id0) { ...PublicUserPlaylistVideoCard }
    video1: video(id: $id1) { ...PublicUserPlaylistVideoCard }
    video2: video(id: $id2) { ...PublicUserPlaylistVideoCard }
    video3: video(id: $id3) { ...PublicUserPlaylistVideoCard }
    video4: video(id: $id4) { ...PublicUserPlaylistVideoCard }
    video5: video(id: $id5) { ...PublicUserPlaylistVideoCard }
    video6: video(id: $id6) { ...PublicUserPlaylistVideoCard }
    video7: video(id: $id7) { ...PublicUserPlaylistVideoCard }
    video8: video(id: $id8) { ...PublicUserPlaylistVideoCard }
    video9: video(id: $id9) { ...PublicUserPlaylistVideoCard }
    video10: video(id: $id10) { ...PublicUserPlaylistVideoCard }
    video11: video(id: $id11) { ...PublicUserPlaylistVideoCard }
    video12: video(id: $id12) { ...PublicUserPlaylistVideoCard }
    video13: video(id: $id13) { ...PublicUserPlaylistVideoCard }
    video14: video(id: $id14) { ...PublicUserPlaylistVideoCard }
    video15: video(id: $id15) { ...PublicUserPlaylistVideoCard }
    video16: video(id: $id16) { ...PublicUserPlaylistVideoCard }
    video17: video(id: $id17) { ...PublicUserPlaylistVideoCard }
    video18: video(id: $id18) { ...PublicUserPlaylistVideoCard }
    video19: video(id: $id19) { ...PublicUserPlaylistVideoCard }
  }
` as const

export const publicUserPlaylistVideosOperation = adminGraphql(
  PUBLIC_USER_PLAYLIST_VIDEOS_QUERY_SOURCE,
)

export const REPORT_USER_PLAYLIST_MUTATION_SOURCE = `
  mutation ReportPublicUserPlaylist($input: UserPlaylistReportInput!) {
    reportUserPlaylist(input: $input) {
      status
    }
  }
` as const

export const reportPublicUserPlaylistOperation = adminGraphql(
  REPORT_USER_PLAYLIST_MUTATION_SOURCE,
)
