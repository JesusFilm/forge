export const USER_PLAYLIST_LIMIT = 20
export const USER_PLAYLIST_BLOCK_LIMIT = 50
export const USER_PLAYLIST_ITEM_LIMIT = 100
export const USER_PLAYLIST_TOTAL_ITEM_LIMIT = 500

export type UserPlaylistMediaItem = {
  videoId: string
}

export type UserPlaylistBlock =
  | {
      kind: "TEXT"
      text: string
    }
  | {
      kind: "MEDIA_COLLECTION"
      title: string
      items: UserPlaylistMediaItem[]
    }
  | {
      kind: "VIDEO_CAROUSEL"
      title: string
      items: UserPlaylistMediaItem[]
    }

export type UserPlaylistSummary = {
  id: string
  title: string
  description: string
  locale: string
  countryCode: string | null
  version: number
  shareState: "SHARED" | "UNSHARED"
}

export type UserPlaylist = UserPlaylistSummary & {
  blocks: UserPlaylistBlock[]
  unavailableVideoIds: string[]
}

export type UserPlaylistPage = {
  items: UserPlaylistSummary[]
  nextCursor: string | null
}

export type UserPlaylistPolicyAcceptance = {
  termsVersion: string
  privacyVersion: string
  communityGuidelinesVersion: string
}

export type UserPlaylistPolicy = {
  terms: { version: string; url: string }
  privacy: { version: string; url: string }
  communityGuidelines: { version: string; url: string }
}

export type CreateUserPlaylistInput = {
  title: string
  description: string
  locale: string
  countryCode: string | null
  blocks: UserPlaylistBlock[]
  acceptance: UserPlaylistPolicyAcceptance
}

export type UpdateUserPlaylistInput = Omit<
  CreateUserPlaylistInput,
  "acceptance"
> & {
  id: string
  expectedVersion: number
}

export type UserPlaylistActionErrorCode =
  | "UNAUTHENTICATED"
  | "INELIGIBLE"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "LIMIT_EXCEEDED"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"

export type UserPlaylistActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      code: UserPlaylistActionErrorCode
      message?: string
    }

export type UserPlaylistCapabilityResult = {
  playlist: UserPlaylist
  capability: string
}

export type UserPlaylistVersionedInput = {
  id: string
  expectedVersion: number
}

export type UserPlaylistOwnerActions = {
  getPolicy: () => Promise<UserPlaylistActionResult<UserPlaylistPolicy>>
  list: (input?: {
    after?: string | null
    first?: number
  }) => Promise<UserPlaylistActionResult<UserPlaylistPage>>
  read: (id: string) => Promise<UserPlaylistActionResult<UserPlaylist>>
  create: (
    input: CreateUserPlaylistInput,
  ) => Promise<UserPlaylistActionResult<UserPlaylistCapabilityResult>>
  update: (
    input: UpdateUserPlaylistInput,
  ) => Promise<UserPlaylistActionResult<UserPlaylist>>
  delete: (
    input: UserPlaylistVersionedInput,
  ) => Promise<UserPlaylistActionResult<{ deleted: boolean }>>
  unshare: (
    input: UserPlaylistVersionedInput,
  ) => Promise<UserPlaylistActionResult<UserPlaylist>>
  reshare: (
    input: UserPlaylistVersionedInput,
  ) => Promise<UserPlaylistActionResult<UserPlaylistCapabilityResult>>
  rotate: (
    input: UserPlaylistVersionedInput,
  ) => Promise<UserPlaylistActionResult<UserPlaylistCapabilityResult>>
  reveal: (
    id: string,
  ) => Promise<UserPlaylistActionResult<{ capability: string }>>
}

export function userPlaylistSharePath(capability: string): string {
  return `/watch/p/${encodeURIComponent(capability)}`
}
