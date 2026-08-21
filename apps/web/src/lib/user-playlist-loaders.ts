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
  UserPlaylistPage,
  UserPlaylistPolicy,
  UserPlaylistSummary,
} from "@/lib/user-playlist-contract"
import { USER_PLAYLIST_LIMIT } from "@/lib/user-playlist-contract"
import {
  adaptOwnerUserPlaylist,
  adaptUserPlaylistSummary,
} from "@/lib/user-playlist-owner-adapter"
import {
  getMyUserPlaylistOperation,
  listMyUserPlaylistsOperation,
} from "@/lib/user-playlist-operations"
import { readConfiguredUserPlaylistPolicy } from "@/lib/user-playlist-policy"

const failure = (
  code: UserPlaylistActionErrorCode,
): { ok: false; code: UserPlaylistActionErrorCode } => ({ ok: false, code })

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
  return readConfiguredUserPlaylistPolicy()
}

export async function loadMyUserPlaylistsForPage(
  input: { first?: number; after?: string | null } = {},
): Promise<UserPlaylistActionResult<UserPlaylistPage>> {
  return withOwnerRead(async (client) => {
    const first = input.first ?? USER_PLAYLIST_LIMIT
    if (!Number.isInteger(first) || first < 1 || first > USER_PLAYLIST_LIMIT) {
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
      const mapped = adaptUserPlaylistSummary(item)
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
    const playlist = adaptOwnerUserPlaylist(result.data.myUserPlaylist)
    return playlist
      ? { ok: true, data: playlist }
      : failure("SERVICE_UNAVAILABLE")
  })
}
