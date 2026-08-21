"use server"

import { cookies, headers } from "next/headers"
import { z } from "zod"

import {
  WEB_AUTH_SESSION_COOKIE,
  readWebAuthSessionCookie,
} from "@/auth/web-session"
import { env } from "@/env"
import { createUserPlaylistAdminClient } from "@/lib/admin-client"
import { isUserPlaylistAuthoringUxEnabled } from "@/lib/feature-flags"
import { getUserPlaylistActionLimiter } from "@/lib/user-playlist-action-rate-limit"
import {
  authorizeUserPlaylistActionRequest,
  signUserPlaylistViewerContext,
} from "@/lib/user-playlist-action-security"
import type {
  CreateUserPlaylistInput,
  UpdateUserPlaylistInput,
  UserPlaylist,
  UserPlaylistActionErrorCode,
  UserPlaylistActionResult,
  UserPlaylistBlock,
  UserPlaylistPage,
  UserPlaylistPolicy,
  UserPlaylistSummary,
  UserPlaylistVersionedInput,
} from "@/lib/user-playlist-contract"
import {
  USER_PLAYLIST_BLOCK_LIMIT,
  USER_PLAYLIST_ITEM_LIMIT,
  USER_PLAYLIST_LIMIT,
  USER_PLAYLIST_TOTAL_ITEM_LIMIT,
} from "@/lib/user-playlist-contract"
import {
  adaptOwnerUserPlaylist,
  adaptUserPlaylistSummary,
} from "@/lib/user-playlist-owner-adapter"
import {
  createUserPlaylistOperation,
  deleteUserPlaylistOperation,
  getMyUserPlaylistOperation,
  listMyUserPlaylistsOperation,
  reshareUserPlaylistOperation,
  revealUserPlaylistCapabilityOperation,
  rotateUserPlaylistCapabilityOperation,
  unshareUserPlaylistOperation,
  updateUserPlaylistOperation,
} from "@/lib/user-playlist-operations"
import { readConfiguredUserPlaylistPolicy } from "@/lib/user-playlist-policy"

const ACTIVE_CONTENT_PATTERN =
  /(?:https?:\/\/|www\.|javascript:|data:|<[^>]*>|```|!\[[^\]]*\]\(|\[[^\]]+\]\(|(?:^|\n)\s{0,3}(?:#{1,6}\s|>\s|[-+*]\s|\d+\.\s)|(?:\*\*|__|~~).+(?:\*\*|__|~~))/i

function plainText(max: number, required = false) {
  let schema = z
    .string()
    .max(max)
    .refine((value) => !ACTIVE_CONTENT_PATTERN.test(value))
  if (required) schema = schema.trim().min(1)
  return schema
}

const mediaItemSchema = z
  .object({
    videoId: z
      .string()
      .min(1)
      .max(191)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  })
  .strict()
const blockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TEXT"), text: plainText(2_000, true) }).strict(),
  z
    .object({
      kind: z.literal("MEDIA_COLLECTION"),
      title: plainText(120, true),
      items: z.array(mediaItemSchema).min(1).max(USER_PLAYLIST_ITEM_LIMIT),
    })
    .strict(),
  z
    .object({
      kind: z.literal("VIDEO_CAROUSEL"),
      title: plainText(120, true),
      items: z.array(mediaItemSchema).min(1).max(USER_PLAYLIST_ITEM_LIMIT),
    })
    .strict(),
])
const snapshotFields = {
  title: plainText(120, true),
  description: plainText(2_000),
  locale: z
    .string()
    .min(2)
    .max(35)
    .refine((value) => {
      if (value.trim() !== value || value.includes("_")) return false
      try {
        return Intl.getCanonicalLocales(value).length === 1
      } catch {
        return false
      }
    }),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  blocks: z.array(blockSchema).max(USER_PLAYLIST_BLOCK_LIMIT),
}
const totalItems = <T extends { blocks: UserPlaylistBlock[] }>(
  input: T,
  context: z.core.$RefinementCtx<T>,
) => {
  const count = input.blocks.reduce(
    (sum, block) => sum + ("items" in block ? block.items.length : 0),
    0,
  )
  if (count > USER_PLAYLIST_TOTAL_ITEM_LIMIT) {
    context.addIssue({ code: "custom", path: ["blocks"] })
  }
}
const createSchema = z
  .object({
    ...snapshotFields,
    acceptance: z
      .object({
        termsVersion: z.string().trim().min(1).max(64),
        privacyVersion: z.string().trim().min(1).max(64),
        communityGuidelinesVersion: z.string().trim().min(1).max(64),
      })
      .strict(),
  })
  .strict()
  .superRefine(totalItems)
const updateSchema = z
  .object({
    id: z.string().min(1).max(191),
    expectedVersion: z.number().int().positive(),
    ...snapshotFields,
  })
  .strict()
  .superRefine(totalItems)
const versionedSchema = z
  .object({
    id: z.string().min(1).max(191),
    expectedVersion: z.number().int().positive(),
  })
  .strict()
const idSchema = z.string().min(1).max(191)
const pageSchema = z
  .object({
    first: z
      .number()
      .int()
      .min(1)
      .max(USER_PLAYLIST_LIMIT)
      .default(USER_PLAYLIST_LIMIT),
    after: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,256}$/)
      .nullable()
      .optional(),
  })
  .strict()

const failure = (
  code: UserPlaylistActionErrorCode,
): { ok: false; code: UserPlaylistActionErrorCode } => ({ ok: false, code })

type OwnerClient = ReturnType<typeof createUserPlaylistAdminClient>

async function isAuthoringEnabled(subject: string): Promise<boolean> {
  try {
    return await isUserPlaylistAuthoringUxEnabled({
      kind: "user",
      key: subject,
      anonymous: false,
      custom: { surface: "user-playlists" },
    })
  } catch {
    return false
  }
}

async function runOwnerAction<T>(
  requiredScopes: readonly string[],
  ingressAction: "read" | "write" | "share" | "reveal",
  task: (client: OwnerClient) => Promise<UserPlaylistActionResult<T>>,
): Promise<UserPlaylistActionResult<T>> {
  const requestHeaders = await headers()
  const admission = authorizeUserPlaylistActionRequest(requestHeaders, {
    allowedOrigins: [env.WEB_BASE_URL, env.NEXT_PUBLIC_CANONICAL_ORIGIN],
  })
  if (!admission.ok) return failure("FORBIDDEN")

  const cookieStore = await cookies()
  const session = await readWebAuthSessionCookie(
    cookieStore.get(WEB_AUTH_SESSION_COOKIE)?.value,
  )
  if (!session) return failure("UNAUTHENTICATED")
  if (!(await isAuthoringEnabled(session.subject))) return failure("FORBIDDEN")
  if (!requiredScopes.every((scope) => session.scopes.includes(scope))) {
    return failure("INELIGIBLE")
  }

  const limit = await getUserPlaylistActionLimiter().consume({
    action: ingressAction,
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

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function mappedAdminError(
  value: unknown,
): UserPlaylistActionResult<never> | null {
  const row = object(value)
  if (row?.__typename !== "UserPlaylistError") return null
  switch (row.code) {
    case "NOT_FOUND":
    case "CONFLICT":
    case "INVALID_INPUT":
    case "LIMIT_EXCEEDED":
    case "SERVICE_UNAVAILABLE":
      return failure(row.code)
    default:
      return failure("SERVICE_UNAVAILABLE")
  }
}

function mapOwnerResult(
  value: unknown,
): UserPlaylistActionResult<UserPlaylist> {
  const error = mappedAdminError(value)
  if (error) return error
  const row = object(value)
  const playlist =
    row?.__typename === "UserPlaylistSuccess"
      ? adaptOwnerUserPlaylist(row.playlist)
      : null
  return playlist
    ? { ok: true, data: playlist }
    : failure("SERVICE_UNAVAILABLE")
}

function graphqlBlocks(blocks: UserPlaylistBlock[]) {
  return blocks.map((item) =>
    item.kind === "TEXT"
      ? { kind: item.kind, text: item.text }
      : { kind: item.kind, title: item.title, items: item.items },
  )
}

export async function getUserPlaylistPolicy(): Promise<
  UserPlaylistActionResult<UserPlaylistPolicy>
> {
  const requestHeaders = await headers()
  const admission = authorizeUserPlaylistActionRequest(requestHeaders, {
    allowedOrigins: [env.WEB_BASE_URL, env.NEXT_PUBLIC_CANONICAL_ORIGIN],
  })
  if (!admission.ok) return failure("FORBIDDEN")
  const cookieStore = await cookies()
  const session = await readWebAuthSessionCookie(
    cookieStore.get(WEB_AUTH_SESSION_COOKIE)?.value,
  )
  if (!session) return failure("UNAUTHENTICATED")
  if (!(await isAuthoringEnabled(session.subject))) return failure("FORBIDDEN")
  if (!session.scopes.includes("playlist:read")) return failure("INELIGIBLE")
  return readConfiguredUserPlaylistPolicy()
}

export async function listMyUserPlaylists(
  input: { first?: number; after?: string | null } = {},
): Promise<UserPlaylistActionResult<UserPlaylistPage>> {
  return runOwnerAction(["playlist:read"], "read", async (client) => {
    const parsed = pageSchema.safeParse(input)
    if (!parsed.success) return failure("INVALID_INPUT")
    const result = await client.query({
      query: listMyUserPlaylistsOperation,
      variables: parsed.data,
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

export async function getMyUserPlaylist(
  id: string,
): Promise<UserPlaylistActionResult<UserPlaylist>> {
  return runOwnerAction(["playlist:read"], "read", async (client) => {
    const parsed = idSchema.safeParse(id)
    if (!parsed.success) return failure("INVALID_INPUT")
    const result = await client.query({
      query: getMyUserPlaylistOperation,
      variables: { id: parsed.data },
      fetchPolicy: "no-cache",
    })
    if (result.data?.myUserPlaylist == null) return failure("NOT_FOUND")
    const playlist = adaptOwnerUserPlaylist(result.data.myUserPlaylist)
    return playlist
      ? { ok: true, data: playlist }
      : failure("SERVICE_UNAVAILABLE")
  })
}

export async function createUserPlaylist(
  input: CreateUserPlaylistInput,
): Promise<UserPlaylistActionResult<UserPlaylist>> {
  return runOwnerAction(
    ["playlist:write", "playlist:share"],
    "write",
    async (client) => {
      const parsed = createSchema.safeParse(input)
      if (!parsed.success) return failure("INVALID_INPUT")
      const result = await client.mutate({
        mutation: createUserPlaylistOperation,
        variables: {
          input: { ...parsed.data, blocks: graphqlBlocks(parsed.data.blocks) },
        },
      })
      return mapOwnerResult(result.data?.createUserPlaylist)
    },
  )
}

export async function updateUserPlaylist(
  input: UpdateUserPlaylistInput,
): Promise<UserPlaylistActionResult<UserPlaylist>> {
  return runOwnerAction(["playlist:write"], "write", async (client) => {
    const parsed = updateSchema.safeParse(input)
    if (!parsed.success) return failure("INVALID_INPUT")
    const result = await client.mutate({
      mutation: updateUserPlaylistOperation,
      variables: {
        input: { ...parsed.data, blocks: graphqlBlocks(parsed.data.blocks) },
      },
    })
    return mapOwnerResult(result.data?.updateUserPlaylist)
  })
}

export async function deleteUserPlaylist(
  input: UserPlaylistVersionedInput,
): Promise<UserPlaylistActionResult<{ deleted: boolean }>> {
  return runOwnerAction(["playlist:write"], "write", async (client) => {
    const parsed = versionedSchema.safeParse(input)
    if (!parsed.success) return failure("INVALID_INPUT")
    const result = await client.mutate({
      mutation: deleteUserPlaylistOperation,
      variables: { input: parsed.data },
    })
    const value = result.data?.deleteUserPlaylist
    const error = mappedAdminError(value)
    if (error) return error
    const row = object(value)
    return row?.__typename === "UserPlaylistDeleteSuccess" &&
      row.deleted === true
      ? { ok: true, data: { deleted: true } }
      : failure("SERVICE_UNAVAILABLE")
  })
}

async function versionedOwnerMutation(
  input: UserPlaylistVersionedInput,
  operation: typeof unshareUserPlaylistOperation,
): Promise<UserPlaylistActionResult<UserPlaylist>> {
  return runOwnerAction(["playlist:share"], "share", async (client) => {
    const parsed = versionedSchema.safeParse(input)
    if (!parsed.success) return failure("INVALID_INPUT")
    const result = await client.mutate({
      mutation: operation,
      variables: { input: parsed.data },
    })
    return mapOwnerResult(result.data?.unshareUserPlaylist)
  })
}

export async function unshareUserPlaylist(
  input: UserPlaylistVersionedInput,
): Promise<UserPlaylistActionResult<UserPlaylist>> {
  return versionedOwnerMutation(input, unshareUserPlaylistOperation)
}

async function versionedShareMutation(
  input: UserPlaylistVersionedInput,
  kind: "reshare" | "rotate",
): Promise<UserPlaylistActionResult<UserPlaylist>> {
  return runOwnerAction(["playlist:share"], "share", async (client) => {
    const parsed = versionedSchema.safeParse(input)
    if (!parsed.success) return failure("INVALID_INPUT")
    if (kind === "reshare") {
      const result = await client.mutate({
        mutation: reshareUserPlaylistOperation,
        variables: { input: parsed.data },
      })
      return mapOwnerResult(result.data?.reshareUserPlaylist)
    }
    const result = await client.mutate({
      mutation: rotateUserPlaylistCapabilityOperation,
      variables: { input: parsed.data },
    })
    return mapOwnerResult(result.data?.rotateUserPlaylistCapability)
  })
}

export async function reshareUserPlaylist(
  input: UserPlaylistVersionedInput,
): Promise<UserPlaylistActionResult<UserPlaylist>> {
  return versionedShareMutation(input, "reshare")
}

export async function rotateUserPlaylistCapability(
  input: UserPlaylistVersionedInput,
): Promise<UserPlaylistActionResult<UserPlaylist>> {
  return versionedShareMutation(input, "rotate")
}

export async function revealUserPlaylistCapability(
  id: string,
): Promise<UserPlaylistActionResult<{ capability: string }>> {
  return runOwnerAction(["playlist:share"], "reveal", async (client) => {
    const parsed = idSchema.safeParse(id)
    if (!parsed.success) return failure("INVALID_INPUT")
    const result = await client.query({
      query: revealUserPlaylistCapabilityOperation,
      variables: { id: parsed.data },
      fetchPolicy: "no-cache",
      context: { fetchOptions: { cache: "no-store" } },
    })
    const capability = result.data?.myUserPlaylistCapability?.capability
    return typeof capability === "string" && capability.length > 0
      ? { ok: true, data: { capability } }
      : failure("NOT_FOUND")
  })
}
