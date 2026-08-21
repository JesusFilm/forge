import { GraphQLError } from "graphql"
import { hasPermission } from "@/auth/permissions"
import {
  USER_PLAYLIST_BLOCK_REASONS,
  USER_PLAYLIST_RESTORE_REASONS,
} from "@/domain/user-playlist-moderation"
import { builder, type ContextShape } from "@/graphql/builder"
import { getUserPlaylistGraphqlRuntime } from "@/graphql/user-playlist-runtime"
import {
  CreateUserPlaylistInput,
  mapUserPlaylistError,
  OwnerUserPlaylistRef,
  requireOwnerContext,
  trustedRequestContext,
  UpdateUserPlaylistInput,
  UserPlaylistGraphqlErrorRef,
  UserPlaylistVersionedInput,
  type UserPlaylistGraphqlError,
} from "@/graphql/types/user-playlist"
import { InvalidInputError } from "@/services/errors"
import { USER_PLAYLIST_REPORT_CATEGORIES } from "@/services/user-playlist-report.service"
import type {
  UserPlaylistModerationResult,
  UserPlaylistModeratorReport,
} from "@/services/user-playlist-moderation.service"
import type { UserPlaylistBlock } from "@/services/user-playlist.schemas"
import type { OwnerUserPlaylist } from "@/services/user-playlist.service"

type InputBlock = {
  kind: "text" | "mediaCollection" | "videoCarousel"
  text?: string | null
  title?: string | null
  items?: readonly { videoId: string | number }[] | null
}

export function normalizeUserPlaylistBlockInput(
  block: InputBlock,
): UserPlaylistBlock {
  if (block.kind === "text") {
    if (
      typeof block.text !== "string" ||
      block.title != null ||
      block.items != null
    )
      throw new InvalidInputError()
    return { t: "text", text: block.text }
  }
  if (block.text != null || !block.items || block.items.length === 0)
    throw new InvalidInputError()
  return {
    t: block.kind,
    ...(block.title == null ? {} : { title: block.title }),
    items: block.items.map((item) => ({ videoId: String(item.videoId) })),
  }
}

function normalizeSnapshotInput(input: {
  title: string
  description: string
  locale: string
  countryCode?: string | null
  blocks: readonly InputBlock[]
}) {
  return {
    title: input.title,
    description: input.description,
    locale: input.locale,
    countryCode: input.countryCode ?? null,
    blocks: input.blocks.map(normalizeUserPlaylistBlockInput),
  }
}

type OwnerResult =
  | { kind: "owner"; playlist: OwnerUserPlaylist }
  | UserPlaylistGraphqlError
type DeleteResult =
  | { kind: "deleted"; deleted: true }
  | UserPlaylistGraphqlError

const OwnerResultSuccessRef = builder
  .objectRef<Extract<OwnerResult, { kind: "owner" }>>("UserPlaylistSuccess")
  .implement({
    fields: (t) => ({
      playlist: t.field({
        type: OwnerUserPlaylistRef,
        resolve: (row) => row.playlist,
      }),
    }),
  })

const DeleteResultSuccessRef = builder
  .objectRef<
    Extract<DeleteResult, { kind: "deleted" }>
  >("UserPlaylistDeleteSuccess")
  .implement({ fields: (t) => ({ deleted: t.exposeBoolean("deleted") }) })

const OwnerMutationResultRef = builder.unionType("UserPlaylistMutationResult", {
  types: [OwnerResultSuccessRef, UserPlaylistGraphqlErrorRef],
  resolveType: (value) =>
    value.kind === "error"
      ? UserPlaylistGraphqlErrorRef
      : OwnerResultSuccessRef,
})
const DeleteMutationResultRef = builder.unionType("UserPlaylistDeleteResult", {
  types: [DeleteResultSuccessRef, UserPlaylistGraphqlErrorRef],
  resolveType: (value) =>
    value.kind === "error"
      ? UserPlaylistGraphqlErrorRef
      : DeleteResultSuccessRef,
})

async function mapped<T>(
  run: () => Promise<T>,
): Promise<T | UserPlaylistGraphqlError> {
  try {
    return await run()
  } catch (error) {
    const mappedError = mapUserPlaylistError(error)
    if (mappedError) return mappedError
    throw error
  }
}

function isMappedError(value: unknown): value is UserPlaylistGraphqlError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "error"
  )
}

function requireCompositeCreateScopes(ctx: ContextShape) {
  if (
    !hasPermission(ctx.user, "write:user-playlists:own") ||
    !hasPermission(ctx.user, "share:user-playlists:own")
  ) {
    throw new GraphQLError("Not authorized")
  }
  return requireOwnerContext(ctx, { canShare: true })
}

builder.mutationFields((t) => ({
  createUserPlaylist: t.field({
    type: OwnerMutationResultRef,
    authScopes: { hasPermission: "write:user-playlists:own" },
    args: { input: t.arg({ type: CreateUserPlaylistInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const result = await mapped(() =>
        getUserPlaylistGraphqlRuntime(ctx.prisma)
          .playlist()
          .create(
            {
              ...normalizeSnapshotInput(input as never),
              acceptance: {
                termsVersion: input.acceptance.termsVersion,
                privacyVersion: input.acceptance.privacyVersion,
                communityGuidelinesVersion:
                  input.acceptance.communityGuidelinesVersion,
              },
            },
            requireCompositeCreateScopes(ctx),
          ),
      )
      return isMappedError(result)
        ? result
        : { kind: "owner" as const, playlist: result }
    },
  }),
  updateUserPlaylist: t.field({
    type: OwnerMutationResultRef,
    authScopes: { hasPermission: "write:user-playlists:own" },
    args: { input: t.arg({ type: UpdateUserPlaylistInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const result = await mapped(() =>
        getUserPlaylistGraphqlRuntime(ctx.prisma)
          .playlist()
          .update(
            {
              ...normalizeSnapshotInput(input as never),
              id: String(input.id),
              expectedVersion: input.expectedVersion,
            },
            requireOwnerContext(ctx),
          ),
      )
      return isMappedError(result)
        ? result
        : { kind: "owner" as const, playlist: result }
    },
  }),
  deleteUserPlaylist: t.field({
    type: DeleteMutationResultRef,
    authScopes: { hasPermission: "write:user-playlists:own" },
    args: {
      input: t.arg({ type: UserPlaylistVersionedInput, required: true }),
    },
    resolve: async (_root, { input }, ctx) => {
      const result = await mapped(() =>
        getUserPlaylistGraphqlRuntime(ctx.prisma)
          .playlist()
          .delete(
            { id: String(input.id), expectedVersion: input.expectedVersion },
            requireOwnerContext(ctx),
          ),
      )
      return isMappedError(result)
        ? result
        : { kind: "deleted" as const, deleted: true as const }
    },
  }),
  unshareUserPlaylist: t.field({
    type: OwnerMutationResultRef,
    authScopes: { hasPermission: "share:user-playlists:own" },
    args: {
      input: t.arg({ type: UserPlaylistVersionedInput, required: true }),
    },
    resolve: async (_root, { input }, ctx) => {
      const result = await mapped(() =>
        getUserPlaylistGraphqlRuntime(ctx.prisma)
          .playlist()
          .unshare(
            { id: String(input.id), expectedVersion: input.expectedVersion },
            requireOwnerContext(ctx, { canShare: true }),
          ),
      )
      return isMappedError(result)
        ? result
        : { kind: "owner" as const, playlist: result }
    },
  }),
  reshareUserPlaylist: t.field({
    type: OwnerMutationResultRef,
    authScopes: { hasPermission: "share:user-playlists:own" },
    args: {
      input: t.arg({ type: UserPlaylistVersionedInput, required: true }),
    },
    resolve: async (_root, { input }, ctx) => {
      const result = await mapped(() =>
        getUserPlaylistGraphqlRuntime(ctx.prisma)
          .playlist()
          .reshare(
            { id: String(input.id), expectedVersion: input.expectedVersion },
            requireOwnerContext(ctx, { canShare: true }),
          ),
      )
      return isMappedError(result)
        ? result
        : { kind: "owner" as const, playlist: result }
    },
  }),
  rotateUserPlaylistCapability: t.field({
    type: OwnerMutationResultRef,
    authScopes: { hasPermission: "share:user-playlists:own" },
    args: {
      input: t.arg({ type: UserPlaylistVersionedInput, required: true }),
    },
    resolve: async (_root, { input }, ctx) => {
      const result = await mapped(() =>
        getUserPlaylistGraphqlRuntime(ctx.prisma)
          .playlist()
          .rotate(
            { id: String(input.id), expectedVersion: input.expectedVersion },
            requireOwnerContext(ctx, { canShare: true }),
          ),
      )
      return isMappedError(result)
        ? result
        : { kind: "owner" as const, playlist: result }
    },
  }),
}))

const UserPlaylistReportCategoryRef = builder.enumType(
  "UserPlaylistReportCategory",
  { values: USER_PLAYLIST_REPORT_CATEGORIES },
)
const UserPlaylistReportInput = builder.inputType("UserPlaylistReportInput", {
  fields: (t) => ({
    reportIntent: t.string({ required: true }),
    category: t.field({ type: UserPlaylistReportCategoryRef, required: true }),
    detail: t.string({ required: false }),
  }),
})
const UserPlaylistReportReceiptRef = builder
  .objectRef<{ status: "RECEIVED" }>("UserPlaylistReportReceipt")
  .implement({ fields: (t) => ({ status: t.exposeString("status") }) })

builder.mutationFields((t) => ({
  reportUserPlaylist: t.field({
    type: UserPlaylistReportReceiptRef,
    authScopes: { public: true },
    args: { input: t.arg({ type: UserPlaylistReportInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      try {
        return await getUserPlaylistGraphqlRuntime(ctx.prisma)
          .report()
          .submit(
            {
              reportIntent: input.reportIntent,
              category: input.category,
              ...(input.detail == null ? {} : { detail: input.detail }),
            },
            trustedRequestContext(ctx).reporterIp,
          )
      } catch {
        return { status: "RECEIVED" as const }
      }
    },
  }),
}))

const UserPlaylistBlockReasonRef = builder.enumType("UserPlaylistBlockReason", {
  values: USER_PLAYLIST_BLOCK_REASONS,
})
const UserPlaylistRestoreReasonRef = builder.enumType(
  "UserPlaylistRestoreReason",
  {
    values: USER_PLAYLIST_RESTORE_REASONS,
  },
)
const UserPlaylistReportDetailStatusRef = builder.enumType(
  "UserPlaylistReportDetailStatus",
  { values: ["AVAILABLE", "ABSENT", "EXPIRED", "UNAVAILABLE"] as const },
)
const UserPlaylistModerationStateRef = builder.enumType(
  "UserPlaylistModerationState",
  { values: ["ACTIVE", "BLOCKED"] as const },
)
const UserPlaylistModerationResultRef = builder
  .objectRef<UserPlaylistModerationResult>("UserPlaylistModerationResult")
  .implement({
    fields: (t) => ({
      playlistId: t.exposeID("playlistId"),
      moderationState: t.expose("moderationState", {
        type: UserPlaylistModerationStateRef,
      }),
      changed: t.exposeBoolean("changed"),
      auditedAt: t.string({ resolve: (row) => row.auditedAt.toISOString() }),
    }),
  })
const UserPlaylistModeratorReportRef = builder
  .objectRef<UserPlaylistModeratorReport>("UserPlaylistModeratorReport")
  .implement({
    fields: (t) => ({
      reportId: t.exposeID("reportId"),
      playlistId: t.exposeID("playlistId"),
      category: t.expose("category", { type: UserPlaylistReportCategoryRef }),
      detailPlainText: t.exposeString("detailPlainText", { nullable: true }),
      detailStatus: t.expose("detailStatus", {
        type: UserPlaylistReportDetailStatusRef,
      }),
      createdAt: t.string({ resolve: (row) => row.createdAt.toISOString() }),
    }),
  })
const UserPlaylistModeratorReportPageRef = builder
  .objectRef<{
    items: UserPlaylistModeratorReport[]
    nextCursor: string | null
  }>("UserPlaylistModeratorReportPage")
  .implement({
    fields: (t) => ({
      items: t.field({
        type: [UserPlaylistModeratorReportRef],
        resolve: (row) => row.items,
      }),
      nextCursor: t.exposeString("nextCursor", { nullable: true }),
    }),
  })

builder.queryField("userPlaylistReportQueue", (t) =>
  t.field({
    type: UserPlaylistModeratorReportPageRef,
    authScopes: { hasPermission: "moderate:user-playlists" },
    args: {
      first: t.arg.int({ required: false, defaultValue: 20 }),
      after: t.arg.string({ required: false }),
      category: t.arg({ type: UserPlaylistReportCategoryRef, required: false }),
    },
    resolve: (_root, args, ctx) =>
      getUserPlaylistGraphqlRuntime(ctx.prisma)
        .moderation()
        .listReports(
          {
            first: args.first ?? 20,
            ...(args.after == null ? {} : { after: args.after }),
            ...(args.category == null ? {} : { category: args.category }),
          },
          ctx.user,
        ),
  }),
)

builder.mutationFields((t) => ({
  blockUserPlaylist: t.field({
    type: UserPlaylistModerationResultRef,
    authScopes: { hasPermission: "moderate:user-playlists" },
    args: {
      playlistId: t.arg.id({ required: true }),
      reason: t.arg({ type: UserPlaylistBlockReasonRef, required: true }),
    },
    resolve: (_root, args, ctx) =>
      getUserPlaylistGraphqlRuntime(ctx.prisma)
        .moderation()
        .block(
          { playlistId: String(args.playlistId), reasonCode: args.reason },
          ctx.user,
        ),
  }),
  restoreUserPlaylist: t.field({
    type: UserPlaylistModerationResultRef,
    authScopes: { hasPermission: "moderate:user-playlists" },
    args: {
      playlistId: t.arg.id({ required: true }),
      reason: t.arg({ type: UserPlaylistRestoreReasonRef, required: true }),
    },
    resolve: (_root, args, ctx) =>
      getUserPlaylistGraphqlRuntime(ctx.prisma)
        .moderation()
        .restore(
          { playlistId: String(args.playlistId), reasonCode: args.reason },
          ctx.user,
        ),
  }),
}))
