import { GraphQLError } from "graphql"
import { z } from "zod"
import { builder, type ContextShape } from "@/graphql/builder"
import { env, resolveUserPlaylistRuntimeControls } from "@/config/env"
import {
  resolveTrustedUserPlaylistRequestContext,
  type TrustedUserPlaylistRequestContext,
} from "@/graphql/user-playlist-request-context"
import { getUserPlaylistGraphqlRuntime } from "@/graphql/user-playlist-runtime"
import type {
  OwnerUserPlaylist,
  OwnerUserPlaylistSummary,
  PublicUserPlaylist,
} from "@/services/user-playlist.service"
import type { UserPlaylistBlock } from "@/services/user-playlist.schemas"
import {
  ConcurrentModificationError,
  ForbiddenError,
  InvalidInputError,
  LimitExceededError,
  NotFoundError,
  ServiceConfigurationError,
  ServiceUnavailableError,
} from "@/services/errors"
import { ConsumerLifecycleUnavailableError } from "@/services/consumer-lifecycle.service"
import { UserPlaylistCapabilityIntegrityError } from "@/services/user-playlist-capability"

type TextBlock = Extract<UserPlaylistBlock, { t: "text" }>
type MediaBlock = Extract<UserPlaylistBlock, { t: "mediaCollection" }>
type CarouselBlock = Extract<UserPlaylistBlock, { t: "videoCarousel" }>

const UserPlaylistMediaItemRef = builder
  .objectRef<{ videoId: string }>("UserPlaylistMediaItem")
  .implement({
    fields: (t) => ({ videoId: t.exposeID("videoId") }),
  })

const UserPlaylistTextBlockRef = builder
  .objectRef<TextBlock>("UserPlaylistTextBlock")
  .implement({
    fields: (t) => ({ text: t.exposeString("text") }),
  })

const UserPlaylistMediaCollectionBlockRef = builder
  .objectRef<MediaBlock>("UserPlaylistMediaCollectionBlock")
  .implement({
    fields: (t) => ({
      title: t.exposeString("title", { nullable: true }),
      items: t.field({
        type: [UserPlaylistMediaItemRef],
        resolve: (block) => block.items,
      }),
    }),
  })

const UserPlaylistVideoCarouselBlockRef = builder
  .objectRef<CarouselBlock>("UserPlaylistVideoCarouselBlock")
  .implement({
    fields: (t) => ({
      title: t.exposeString("title", { nullable: true }),
      items: t.field({
        type: [UserPlaylistMediaItemRef],
        resolve: (block) => block.items,
      }),
    }),
  })

export const UserPlaylistBlockRef = builder.unionType("UserPlaylistBlock", {
  types: [
    UserPlaylistTextBlockRef,
    UserPlaylistMediaCollectionBlockRef,
    UserPlaylistVideoCarouselBlockRef,
  ],
  resolveType: (block) => {
    switch (block.t) {
      case "text":
        return UserPlaylistTextBlockRef
      case "mediaCollection":
        return UserPlaylistMediaCollectionBlockRef
      case "videoCarousel":
        return UserPlaylistVideoCarouselBlockRef
    }
  },
})

export const OwnerUserPlaylistRef = builder
  .objectRef<OwnerUserPlaylist>("OwnerUserPlaylist")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      title: t.exposeString("title"),
      description: t.exposeString("description"),
      locale: t.exposeString("locale"),
      countryCode: t.exposeString("countryCode", { nullable: true }),
      version: t.exposeInt("version"),
      shared: t.exposeBoolean("shared"),
      blocks: t.field({
        type: [UserPlaylistBlockRef],
        resolve: (row) => row.blocks,
      }),
      unavailableVideoIds: t.idList({
        resolve: (row) => row.unavailableVideoIds,
      }),
    }),
  })

export const OwnerUserPlaylistSummaryRef = builder
  .objectRef<OwnerUserPlaylistSummary>("OwnerUserPlaylistSummary")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      title: t.exposeString("title"),
      description: t.exposeString("description"),
      locale: t.exposeString("locale"),
      countryCode: t.exposeString("countryCode", { nullable: true }),
      version: t.exposeInt("version"),
      shared: t.exposeBoolean("shared"),
    }),
  })

type OwnerPage = {
  items: OwnerUserPlaylistSummary[]
  nextCursor: string | null
}
export const OwnerUserPlaylistPageRef = builder
  .objectRef<OwnerPage>("OwnerUserPlaylistPage")
  .implement({
    fields: (t) => ({
      items: t.field({
        type: [OwnerUserPlaylistSummaryRef],
        resolve: (row) => row.items,
      }),
      nextCursor: t.exposeString("nextCursor", { nullable: true }),
    }),
  })

type PublicGraphqlPlaylist = PublicUserPlaylist & { reportIntent: string }
export const PublicUserPlaylistRef = builder
  .objectRef<PublicGraphqlPlaylist>("PublicUserPlaylist")
  .implement({
    fields: (t) => ({
      title: t.exposeString("title"),
      description: t.exposeString("description"),
      locale: t.exposeString("locale"),
      countryCode: t.exposeString("countryCode", { nullable: true }),
      blocks: t.field({
        type: [UserPlaylistBlockRef],
        resolve: (row) => row.blocks,
      }),
      reportIntent: t.exposeString("reportIntent"),
    }),
  })

export const UserPlaylistCapabilityRef = builder
  .objectRef<{ capability: string }>("UserPlaylistCapability")
  .implement({ fields: (t) => ({ capability: t.exposeString("capability") }) })

export const UserPlaylistBlockKind = builder.enumType("UserPlaylistBlockKind", {
  values: {
    TEXT: { value: "text" },
    MEDIA_COLLECTION: { value: "mediaCollection" },
    VIDEO_CAROUSEL: { value: "videoCarousel" },
  } as const,
})

export const UserPlaylistMediaItemInput = builder.inputType(
  "UserPlaylistMediaItemInput",
  { fields: (t) => ({ videoId: t.id({ required: true }) }) },
)

export const UserPlaylistBlockInput = builder.inputType(
  "UserPlaylistBlockInput",
  {
    fields: (t) => ({
      kind: t.field({ type: UserPlaylistBlockKind, required: true }),
      text: t.string({ required: false }),
      title: t.string({ required: false }),
      items: t.field({ type: [UserPlaylistMediaItemInput], required: false }),
    }),
  },
)

export const UserPlaylistAcceptanceInput = builder.inputType(
  "UserPlaylistAcceptanceInput",
  {
    fields: (t) => ({
      termsVersion: t.string({ required: true }),
      privacyVersion: t.string({ required: true }),
      communityGuidelinesVersion: t.string({ required: true }),
    }),
  },
)

const snapshotInputFields = (
  t: Parameters<Parameters<typeof builder.inputType>[1]["fields"]>[0],
) => ({
  title: t.string({ required: true }),
  description: t.string({ required: true }),
  locale: t.string({ required: true }),
  countryCode: t.string({ required: false }),
  blocks: t.field({ type: [UserPlaylistBlockInput], required: true }),
})

export const CreateUserPlaylistInput = builder.inputType(
  "CreateUserPlaylistInput",
  {
    fields: (t) => ({
      ...snapshotInputFields(t),
      acceptance: t.field({
        type: UserPlaylistAcceptanceInput,
        required: true,
      }),
    }),
  },
)

export const UpdateUserPlaylistInput = builder.inputType(
  "UpdateUserPlaylistInput",
  {
    fields: (t) => ({
      id: t.id({ required: true }),
      expectedVersion: t.int({ required: true }),
      ...snapshotInputFields(t),
    }),
  },
)

export const UserPlaylistVersionedInput = builder.inputType(
  "UserPlaylistVersionedInput",
  {
    fields: (t) => ({
      id: t.id({ required: true }),
      expectedVersion: t.int({ required: true }),
    }),
  },
)

export type UserPlaylistGraphqlErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_INPUT"
  | "LIMIT_EXCEEDED"
  | "SERVICE_UNAVAILABLE"

export type UserPlaylistGraphqlError = {
  kind: "error"
  code: UserPlaylistGraphqlErrorCode
  message: string
}

export const UserPlaylistGraphqlErrorCodeRef = builder.enumType(
  "UserPlaylistErrorCode",
  {
    values: [
      "NOT_FOUND",
      "CONFLICT",
      "INVALID_INPUT",
      "LIMIT_EXCEEDED",
      "SERVICE_UNAVAILABLE",
    ] as const,
  },
)

export const UserPlaylistGraphqlErrorRef = builder
  .objectRef<UserPlaylistGraphqlError>("UserPlaylistError")
  .implement({
    fields: (t) => ({
      code: t.expose("code", { type: UserPlaylistGraphqlErrorCodeRef }),
      message: t.exposeString("message"),
    }),
  })

export function mapUserPlaylistError(
  error: unknown,
): UserPlaylistGraphqlError | null {
  let code: UserPlaylistGraphqlErrorCode
  if (error instanceof NotFoundError || error instanceof ForbiddenError)
    code = "NOT_FOUND"
  else if (error instanceof ConcurrentModificationError) code = "CONFLICT"
  else if (error instanceof LimitExceededError) code = "LIMIT_EXCEEDED"
  else if (error instanceof InvalidInputError || error instanceof z.ZodError)
    code = "INVALID_INPUT"
  else if (
    error instanceof ServiceUnavailableError ||
    error instanceof ServiceConfigurationError ||
    error instanceof ConsumerLifecycleUnavailableError ||
    error instanceof UserPlaylistCapabilityIntegrityError ||
    (error instanceof Error &&
      /(?:ConfigurationError|runtime is not configured)$/.test(error.name))
  )
    code = "SERVICE_UNAVAILABLE"
  else return null

  const messages: Record<UserPlaylistGraphqlErrorCode, string> = {
    NOT_FOUND: "Playlist not found",
    CONFLICT: "Playlist changed; reload and try again",
    INVALID_INPUT: "Playlist input is invalid",
    LIMIT_EXCEEDED: "Playlist limit exceeded",
    SERVICE_UNAVAILABLE: "Playlist service is temporarily unavailable",
  }
  return { kind: "error", code, message: messages[code] }
}

export function requireOwnerContext(
  ctx: ContextShape,
  options: { canShare?: boolean } = {},
) {
  if (!resolveUserPlaylistRuntimeControls().authoringEnabled) {
    throw new GraphQLError("Playlist service is temporarily unavailable", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    })
  }
  if (typeof ctx.user?.id !== "string" || ctx.user.id.length === 0) {
    throw new GraphQLError("Authentication required")
  }
  const trusted = trustedRequestContext(ctx)
  return {
    ownerSubject: ctx.user.id,
    canShare: options.canShare === true,
    viewerCountry: trusted.viewerCountry,
  }
}

export function trustedRequestContext(
  ctx: ContextShape,
): TrustedUserPlaylistRequestContext {
  return resolveTrustedUserPlaylistRequestContext(ctx.request, {
    secret: env.USER_PLAYLIST_TRUSTED_CONTEXT_HMAC_SECRET,
  })
}

function unavailable(): never {
  throw new GraphQLError("Playlist service is temporarily unavailable", {
    extensions: {
      code: "SERVICE_UNAVAILABLE",
      http: { status: 503 },
    },
  })
}

function decodeCursor(cursor: string | null | undefined): string | null {
  if (!cursor) return null
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(cursor)) return null
  const decoded = Buffer.from(cursor, "base64url")
  if (decoded.toString("base64url") !== cursor) return null
  const value = decoded.toString("utf8")
  return /^[A-Za-z0-9_-]{1,191}$/.test(value) ? value : null
}

function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url")
}

export function paginateOwnerPlaylists(
  rows: OwnerUserPlaylistSummary[],
  input: { first: number; cursor: string | null },
): OwnerPage {
  const cursorIndex = input.cursor
    ? rows.findIndex((row) => row.id === input.cursor)
    : -1
  if (input.cursor && cursorIndex < 0) throw new GraphQLError("Invalid cursor")
  const start = cursorIndex + 1
  const items = rows.slice(start, start + input.first)
  return {
    items,
    nextCursor:
      start + input.first < rows.length && items.length > 0
        ? encodeCursor(items.at(-1)!.id)
        : null,
  }
}

builder.queryFields((t) => ({
  myUserPlaylists: t.field({
    type: OwnerUserPlaylistPageRef,
    authScopes: { hasPermission: "read:user-playlists:own" },
    args: {
      first: t.arg.int({ required: false, defaultValue: 20 }),
      after: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const context = requireOwnerContext(ctx)
      const first = Math.min(Math.max(args.first ?? 20, 1), 20)
      const cursor = decodeCursor(args.after)
      if (args.after && !cursor) throw new GraphQLError("Invalid cursor")
      try {
        const rows = await getUserPlaylistGraphqlRuntime(ctx.prisma)
          .playlist()
          .list(context)
        return paginateOwnerPlaylists(rows, { first, cursor })
      } catch (error) {
        if (mapUserPlaylistError(error)?.code === "SERVICE_UNAVAILABLE")
          unavailable()
        throw error
      }
    },
  }),
  myUserPlaylist: t.field({
    type: OwnerUserPlaylistRef,
    nullable: true,
    authScopes: { hasPermission: "read:user-playlists:own" },
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_root, args, ctx) => {
      try {
        return await getUserPlaylistGraphqlRuntime(ctx.prisma)
          .playlist()
          .read({ id: String(args.id) }, requireOwnerContext(ctx))
      } catch (error) {
        const mapped = mapUserPlaylistError(error)
        if (mapped?.code === "NOT_FOUND") return null
        if (mapped?.code === "SERVICE_UNAVAILABLE") unavailable()
        throw error
      }
    },
  }),
  myUserPlaylistCapability: t.field({
    type: UserPlaylistCapabilityRef,
    nullable: true,
    authScopes: { hasPermission: "share:user-playlists:own" },
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_root, args, ctx) => {
      try {
        const capability = await getUserPlaylistGraphqlRuntime(ctx.prisma)
          .playlist()
          .reveal(
            { id: String(args.id) },
            requireOwnerContext(ctx, { canShare: true }),
          )
        return { capability }
      } catch (error) {
        const mapped = mapUserPlaylistError(error)
        if (mapped?.code === "NOT_FOUND") return null
        if (mapped?.code === "SERVICE_UNAVAILABLE") unavailable()
        throw error
      }
    },
  }),
  userPlaylistByToken: t.field({
    type: PublicUserPlaylistRef,
    nullable: true,
    authScopes: { public: true },
    args: { token: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!resolveUserPlaylistRuntimeControls().anonymousPublicReadEnabled)
        return null
      const trusted = trustedRequestContext(ctx)
      const runtime = getUserPlaylistGraphqlRuntime(ctx.prisma)
      try {
        const access = await runtime.playlist().resolvePublicAccess({
          token: args.token,
          viewerCountry: trusted.viewerCountry,
        })
        if (!access) return null
        return {
          ...access.playlist,
          reportIntent: runtime.report().issueIntent({
            playlistId: access.playlistId,
            capabilityDigest: access.capabilityDigest,
          }),
        }
      } catch (error) {
        if (mapUserPlaylistError(error)?.code === "SERVICE_UNAVAILABLE")
          unavailable()
        throw error
      }
    },
  }),
}))
