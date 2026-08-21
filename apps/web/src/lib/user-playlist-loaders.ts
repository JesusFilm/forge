import "server-only"

import { cookies, headers } from "next/headers"

import {
  WEB_AUTH_SESSION_COOKIE,
  readWebAuthSessionCookie,
} from "@/auth/web-session"
import { env } from "@/env"
import { createUserPlaylistAdminClient } from "@/lib/admin-client"
import { getUserPlaylistActionLimiter } from "@/lib/user-playlist-action-rate-limit"
import {
  authorizeUserPlaylistServerRenderRequest,
  signUserPlaylistViewerContext,
} from "@/lib/user-playlist-action-security"
import type {
  UserPlaylist,
  UserPlaylistActionErrorCode,
  UserPlaylistActionResult,
  UserPlaylistBlock,
  UserPlaylistPage,
  UserPlaylistPolicy,
  UserPlaylistSummary,
} from "@/lib/user-playlist-contract"
import {
  getMyUserPlaylistOperation,
  listMyUserPlaylistsOperation,
} from "@/lib/user-playlist-operations"

const failure = (
  code: UserPlaylistActionErrorCode,
): { ok: false; code: UserPlaylistActionErrorCode } => ({ ok: false, code })

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function mapSummary(value: unknown): UserPlaylistSummary | null {
  const row = object(value)
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.title !== "string" ||
    typeof row.description !== "string" ||
    typeof row.locale !== "string" ||
    (row.countryCode !== null && typeof row.countryCode !== "string") ||
    typeof row.version !== "number" ||
    typeof row.shared !== "boolean"
  ) {
    return null
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    locale: row.locale,
    countryCode: row.countryCode,
    version: row.version,
    shareState: row.shared ? "SHARED" : "UNSHARED",
  }
}

function mapBlock(value: unknown): UserPlaylistBlock | null {
  const row = object(value)
  if (row?.__typename === "UserPlaylistTextBlock") {
    return typeof row.text === "string"
      ? { kind: "TEXT", text: row.text }
      : null
  }
  if (
    row?.__typename !== "UserPlaylistMediaCollectionBlock" &&
    row?.__typename !== "UserPlaylistVideoCarouselBlock"
  ) {
    return null
  }
  if (!Array.isArray(row.items)) return null
  const items: Array<{ videoId: string }> = []
  for (const item of row.items) {
    const media = object(item)
    if (!media || typeof media.videoId !== "string") return null
    items.push({ videoId: media.videoId })
  }
  return {
    kind:
      row.__typename === "UserPlaylistMediaCollectionBlock"
        ? "MEDIA_COLLECTION"
        : "VIDEO_CAROUSEL",
    title: typeof row.title === "string" ? row.title : "",
    items,
  }
}

function mapOwner(value: unknown): UserPlaylist | null {
  const base = mapSummary(value)
  const row = object(value)
  if (
    !base ||
    !row ||
    !Array.isArray(row.blocks) ||
    !Array.isArray(row.unavailableVideoIds) ||
    !row.unavailableVideoIds.every((id) => typeof id === "string")
  ) {
    return null
  }
  const blocks: UserPlaylistBlock[] = []
  for (const input of row.blocks) {
    const mapped = mapBlock(input)
    if (!mapped) return null
    blocks.push(mapped)
  }
  return {
    ...base,
    blocks,
    unavailableVideoIds: row.unavailableVideoIds as string[],
  }
}

async function withOwnerRead<T>(
  task: (
    client: ReturnType<typeof createUserPlaylistAdminClient>,
  ) => Promise<UserPlaylistActionResult<T>>,
): Promise<UserPlaylistActionResult<T>> {
  const requestHeaders = await headers()
  const admission = authorizeUserPlaylistServerRenderRequest(requestHeaders, {
    allowedOrigins: [env.WEB_BASE_URL, env.NEXT_PUBLIC_CANONICAL_ORIGIN],
  })
  if (!admission.ok) return failure("FORBIDDEN")

  const cookieStore = await cookies()
  const session = await readWebAuthSessionCookie(
    cookieStore.get(WEB_AUTH_SESSION_COOKIE)?.value,
  )
  if (!session) return failure("UNAUTHENTICATED")
  if (!session.scopes.includes("playlist:read")) return failure("INELIGIBLE")

  const limit = await getUserPlaylistActionLimiter().consume({
    action: "read",
    subject: session.subject,
    viewerIp: admission.context.viewerIp,
    now: new Date(),
  })
  if (limit === "limited") return failure("RATE_LIMITED")
  if (limit !== "admitted") return failure("SERVICE_UNAVAILABLE")

  try {
    const contextHeaders = signUserPlaylistViewerContext(admission.context, {
      secret: env.USER_PLAYLIST_TRUSTED_CONTEXT_HMAC_SECRET,
    })
    return await task(
      createUserPlaylistAdminClient(session.accessToken, contextHeaders),
    )
  } catch {
    return failure("SERVICE_UNAVAILABLE")
  }
}

export async function loadUserPlaylistPolicyForPage(): Promise<
  UserPlaylistActionResult<UserPlaylistPolicy>
> {
  const values = [
    env.USER_PLAYLIST_TERMS_VERSION,
    env.USER_PLAYLIST_TERMS_URL,
    env.USER_PLAYLIST_PRIVACY_VERSION,
    env.USER_PLAYLIST_PRIVACY_URL,
    env.USER_PLAYLIST_COMMUNITY_GUIDELINES_VERSION,
    env.USER_PLAYLIST_COMMUNITY_GUIDELINES_URL,
  ]
  if (values.some((value) => !value)) return failure("SERVICE_UNAVAILABLE")
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

export async function loadMyUserPlaylistsForPage(
  input: { first?: number; after?: string | null } = {},
): Promise<UserPlaylistActionResult<UserPlaylistPage>> {
  return withOwnerRead(async (client) => {
    const first = input.first ?? 20
    if (!Number.isInteger(first) || first < 1 || first > 20) {
      return failure("INVALID_INPUT")
    }
    if (input.after != null && !/^[A-Za-z0-9_-]{1,256}$/.test(input.after)) {
      return failure("INVALID_INPUT")
    }
    const result = await client.query({
      query: listMyUserPlaylistsOperation,
      variables: { first, after: input.after ?? null },
      fetchPolicy: "no-cache",
    })
    const page = result.data?.myUserPlaylists
    if (!page || !Array.isArray(page.items))
      return failure("SERVICE_UNAVAILABLE")
    const items: UserPlaylistSummary[] = []
    for (const item of page.items) {
      const mapped = mapSummary(item)
      if (!mapped) return failure("SERVICE_UNAVAILABLE")
      items.push(mapped)
    }
    return {
      ok: true,
      data: {
        items,
        nextCursor:
          typeof page.nextCursor === "string" ? page.nextCursor : null,
      },
    }
  })
}

export async function loadMyUserPlaylistForPage(
  id: string,
): Promise<UserPlaylistActionResult<UserPlaylist>> {
  return withOwnerRead(async (client) => {
    if (typeof id !== "string" || id.length < 1 || id.length > 191) {
      return failure("INVALID_INPUT")
    }
    const result = await client.query({
      query: getMyUserPlaylistOperation,
      variables: { id },
      fetchPolicy: "no-cache",
    })
    if (result.data?.myUserPlaylist == null) return failure("NOT_FOUND")
    const playlist = mapOwner(result.data.myUserPlaylist)
    return playlist
      ? { ok: true, data: playlist }
      : failure("SERVICE_UNAVAILABLE")
  })
}
