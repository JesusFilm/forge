import type { WatchEvent } from "@prisma/client"

import { builder } from "@/graphql/builder"

const WatchEventTypeEnum = builder.enumType("WatchEventType", {
  values: {
    download: { value: "download" },
    meaningful_playback: { value: "meaningful_playback" },
  } as const,
})

const WatchEventRef = builder.objectRef<WatchEvent>("WatchEvent").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    videoId: t.exposeString("videoId"),
    videoDubId: t.exposeString("videoDubId", { nullable: true }),
    languageId: t.exposeString("languageId", { nullable: true }),
    eventType: t.exposeString("eventType"),
    positionSeconds: t.exposeInt("positionSeconds", { nullable: true }),
    durationSeconds: t.exposeInt("durationSeconds", { nullable: true }),
    progress: t.exposeFloat("progress", { nullable: true }),
    occurredAt: t.string({
      resolve: (row) => row.occurredAt.toISOString(),
    }),
    createdAt: t.string({
      resolve: (row) => row.createdAt.toISOString(),
    }),
  }),
})

builder.mutationFields((t) => ({
  recordWatchEvent: t.field({
    type: WatchEventRef,
    authScopes: { hasPermission: "write:watch-events" },
    args: {
      videoId: t.arg.id({ required: true }),
      videoDubId: t.arg.id({ required: false }),
      languageId: t.arg.id({ required: false }),
      eventType: t.arg({ type: WatchEventTypeEnum, required: true }),
      positionSeconds: t.arg.int({ required: false }),
      durationSeconds: t.arg.int({ required: false }),
      progress: t.arg.float({ required: false }),
      requestSessionId: t.arg.string({ required: false }),
      occurredAt: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.watchEvent.create({
        user: ctx.user,
        input: {
          videoId: String(args.videoId),
          videoDubId:
            args.videoDubId != null ? String(args.videoDubId) : undefined,
          languageId:
            args.languageId != null ? String(args.languageId) : undefined,
          eventType: args.eventType,
          positionSeconds: args.positionSeconds,
          durationSeconds: args.durationSeconds,
          progress: args.progress,
          requestSessionId: args.requestSessionId,
          occurredAt: args.occurredAt,
        },
      }),
  }),
}))
