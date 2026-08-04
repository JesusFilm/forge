// Viewer-scoped watch-progress surface (mobile continue-watching).
//
// All three operations resolve the account solely from the verified
// principal (R13) — no argument carries a user id, and the server-to-server
// internal REST route stays the only surface that accepts one. Gated by the
// own-data permission keys the MOBILE_USER principal carries (ADMIN retains
// them as operational override).

import { GraphQLError } from "graphql"

import { builder } from "@/graphql/builder"
import type { Principal } from "@/auth/principal"
import {
  deleteWatchProgressForVideo,
  listWatchProgress,
  upsertWatchProgress,
  type WatchProgressView,
} from "@/services/watch-progress.service"

// Mirrors the internal REST route's per-request ceiling and the store's
// 200-entry contract.
const MAX_ENTRIES = 200

function requireOwnDataSubject(user: Principal | null): string {
  if (typeof user?.id !== "string" || user.id.length === 0) {
    throw new GraphQLError("Authentication required")
  }
  return user.id
}

const WatchProgressEntryRef = builder
  .objectRef<WatchProgressView>("WatchProgressEntry")
  .implement({
    fields: (t) => ({
      videoId: t.exposeString("videoId"),
      languageSlug: t.exposeString("languageSlug", { nullable: true }),
      positionSeconds: t.exposeInt("positionSeconds"),
      durationSeconds: t.exposeInt("durationSeconds"),
      completed: t.exposeBoolean("completed"),
      updatedAt: t.exposeString("updatedAt"),
    }),
  })

const WatchProgressUpsertInput = builder.inputType("WatchProgressUpsertInput", {
  fields: (t) => ({
    videoId: t.id({ required: false }),
    // Offline (downloaded) playback records by slug — the downloads
    // manifest stores no video id; the service resolves it (KTD8).
    videoSlug: t.string({ required: false }),
    languageSlug: t.string({ required: false }),
    positionSeconds: t.float({ required: true }),
    durationSeconds: t.float({ required: true }),
    // Required, carrying the device's RECORDING time: the service falls
    // back to now-time when absent, which would make every stale offline
    // entry look newest and defeat the monotonic guard.
    updatedAt: t.string({ required: true }),
  }),
})

builder.queryFields((t) => ({
  myWatchProgress: t.field({
    type: [WatchProgressEntryRef],
    authScopes: { hasPermission: "read:watch-progress:own" },
    resolve: (_root, _args, ctx) =>
      listWatchProgress({ userId: requireOwnDataSubject(ctx.user) }),
  }),
}))

builder.mutationFields((t) => ({
  upsertMyWatchProgress: t.field({
    type: [WatchProgressEntryRef],
    authScopes: { hasPermission: "write:watch-progress:own" },
    args: {
      entries: t.arg({
        type: [WatchProgressUpsertInput],
        required: true,
      }),
    },
    resolve: (_root, args, ctx) => {
      const userId = requireOwnDataSubject(ctx.user)
      if (args.entries.length === 0) return []
      if (args.entries.length > MAX_ENTRIES) {
        throw new GraphQLError(`At most ${MAX_ENTRIES} entries per batch`)
      }
      for (const entry of args.entries) {
        if (entry.videoId == null && !entry.videoSlug) {
          throw new GraphQLError("Each entry needs a videoId or a videoSlug")
        }
      }
      return upsertWatchProgress({
        userId,
        entries: args.entries.map((entry) => ({
          videoId: entry.videoId != null ? String(entry.videoId) : null,
          videoSlug: entry.videoSlug,
          languageSlug: entry.languageSlug,
          positionSeconds: entry.positionSeconds,
          durationSeconds: entry.durationSeconds,
          updatedAt: entry.updatedAt,
        })),
      })
    },
  }),
  clearMyWatchProgress: t.field({
    type: "Boolean",
    authScopes: { hasPermission: "delete:watch-progress:own" },
    args: {
      videoId: t.arg.id({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const userId = requireOwnDataSubject(ctx.user)
      const result = await deleteWatchProgressForVideo({
        userId,
        videoId: String(args.videoId),
      })
      return result.deletedCount > 0
    },
  }),
}))
