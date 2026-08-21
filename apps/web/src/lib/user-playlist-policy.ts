import "server-only"

import { env } from "@/env"
import type {
  UserPlaylistActionResult,
  UserPlaylistPolicy,
} from "@/lib/user-playlist-contract"

export function readConfiguredUserPlaylistPolicy(): UserPlaylistActionResult<UserPlaylistPolicy> {
  const values = [
    env.USER_PLAYLIST_TERMS_VERSION,
    env.USER_PLAYLIST_TERMS_URL,
    env.USER_PLAYLIST_PRIVACY_VERSION,
    env.USER_PLAYLIST_PRIVACY_URL,
    env.USER_PLAYLIST_COMMUNITY_GUIDELINES_VERSION,
    env.USER_PLAYLIST_COMMUNITY_GUIDELINES_URL,
  ]
  if (values.some((value) => !value)) {
    return { ok: false, code: "SERVICE_UNAVAILABLE" }
  }
  return {
    ok: true,
    data: {
      terms: {
        version: env.USER_PLAYLIST_TERMS_VERSION!,
        url: env.USER_PLAYLIST_TERMS_URL!,
      },
      privacy: {
        version: env.USER_PLAYLIST_PRIVACY_VERSION!,
        url: env.USER_PLAYLIST_PRIVACY_URL!,
      },
      communityGuidelines: {
        version: env.USER_PLAYLIST_COMMUNITY_GUIDELINES_VERSION!,
        url: env.USER_PLAYLIST_COMMUNITY_GUIDELINES_URL!,
      },
    },
  }
}
