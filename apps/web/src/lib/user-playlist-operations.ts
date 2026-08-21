import { adminGraphql } from "@forge/admin-graphql"

const userPlaylistSummaryFragment = adminGraphql(`
  fragment UserPlaylistOwnerSummaryFields on OwnerUserPlaylistSummary @_unmask {
    id
    title
    description
    locale
    countryCode
    version
    shared
  }
`)

const userPlaylistOwnerFragment = adminGraphql(`
  fragment UserPlaylistOwnerFields on OwnerUserPlaylist @_unmask {
    id
    title
    description
    locale
    countryCode
    version
    shared
    unavailableVideoIds
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
`)

export const listMyUserPlaylistsOperation = adminGraphql(
  `
    query ListMyUserPlaylists($first: Int, $after: String) {
      myUserPlaylists(first: $first, after: $after) {
        items {
          ...UserPlaylistOwnerSummaryFields
        }
        nextCursor
      }
    }
  `,
  [userPlaylistSummaryFragment],
)

export const getMyUserPlaylistOperation = adminGraphql(
  `
    query GetMyUserPlaylist($id: ID!) {
      myUserPlaylist(id: $id) {
        ...UserPlaylistOwnerFields
      }
    }
  `,
  [userPlaylistOwnerFragment],
)

export const createUserPlaylistOperation = adminGraphql(
  `
    mutation CreateUserPlaylist($input: CreateUserPlaylistInput!) {
      createUserPlaylist(input: $input) {
        __typename
        ... on UserPlaylistSuccess {
          playlist {
            ...UserPlaylistOwnerFields
          }
        }
        ... on UserPlaylistError {
          code
          message
        }
      }
    }
  `,
  [userPlaylistOwnerFragment],
)

export const updateUserPlaylistOperation = adminGraphql(
  `
    mutation UpdateUserPlaylist($input: UpdateUserPlaylistInput!) {
      updateUserPlaylist(input: $input) {
        __typename
        ... on UserPlaylistSuccess {
          playlist {
            ...UserPlaylistOwnerFields
          }
        }
        ... on UserPlaylistError {
          code
          message
        }
      }
    }
  `,
  [userPlaylistOwnerFragment],
)

export const deleteUserPlaylistOperation = adminGraphql(`
  mutation DeleteUserPlaylist($input: UserPlaylistVersionedInput!) {
    deleteUserPlaylist(input: $input) {
      __typename
      ... on UserPlaylistDeleteSuccess {
        deleted
      }
      ... on UserPlaylistError {
        code
        message
      }
    }
  }
`)

export const unshareUserPlaylistOperation = adminGraphql(
  `
    mutation UnshareUserPlaylist($input: UserPlaylistVersionedInput!) {
      unshareUserPlaylist(input: $input) {
        __typename
        ... on UserPlaylistSuccess {
          playlist {
            ...UserPlaylistOwnerFields
          }
        }
        ... on UserPlaylistError {
          code
          message
        }
      }
    }
  `,
  [userPlaylistOwnerFragment],
)

export const reshareUserPlaylistOperation = adminGraphql(
  `
    mutation ReshareUserPlaylist($input: UserPlaylistVersionedInput!) {
      reshareUserPlaylist(input: $input) {
        __typename
        ... on UserPlaylistSuccess {
          playlist {
            ...UserPlaylistOwnerFields
          }
        }
        ... on UserPlaylistError {
          code
          message
        }
      }
    }
  `,
  [userPlaylistOwnerFragment],
)

export const rotateUserPlaylistCapabilityOperation = adminGraphql(
  `
    mutation RotateUserPlaylistCapability(
      $input: UserPlaylistVersionedInput!
    ) {
      rotateUserPlaylistCapability(input: $input) {
        __typename
        ... on UserPlaylistSuccess {
          playlist {
            ...UserPlaylistOwnerFields
          }
        }
        ... on UserPlaylistError {
          code
          message
        }
      }
    }
  `,
  [userPlaylistOwnerFragment],
)

export const revealUserPlaylistCapabilityOperation = adminGraphql(`
  query RevealUserPlaylistCapability($id: ID!) {
    myUserPlaylistCapability(id: $id) {
      capability
    }
  }
`)
