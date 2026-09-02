/** @classification public-shape */
import { builder } from "@/graphql/builder"
import { prisma } from "@/db/client"
import {
  createRecommendationEvidenceService,
  type RecommendationEvidenceReceipt,
} from "@/services/recommendations/evidence.service"
import { createRecommendationEpisodeService } from "@/services/recommendations/episode.service"
import {
  createRecommendationPlaybackContextService,
  type RecommendationPlaybackContextClaim,
} from "@/services/recommendations/playback-context.service"
import { RecommendationInputError } from "@/services/recommendations/errors"
import { resolveRecommendationOperation } from "@/graphql/recommendation-errors"
import {
  createRecommendationPlaybackService,
  type RecommendationPlaybackReceipt,
} from "@/services/recommendations/playback.service"
import {
  createRecommendationContentActionService,
  type RecommendationContentActionReceipt,
} from "@/services/recommendations/content-action.service"

type SelectionReceipt = {
  status: "accepted" | "replay" | "conflict"
  claimNonce: string | null
  canonicalHref: string
  targetMediaId: string
}

type EpisodeClaim = {
  contextId: string
  episodeId: string
  capability: string
  activeUntil: string
  hardUntil: string
}

const RecommendationEvidenceEventInput = builder.inputType(
  "RecommendationEvidenceEventInput",
  {
    fields: (t) => ({
      eventId: t.string({ required: true }),
      kind: t.string({ required: true }),
      occurredAt: t.string({ required: true }),
      payload: t.field({ type: "JSON", required: true }),
    }),
  },
)

const RecommendationPlaybackEventInput = builder.inputType(
  "RecommendationPlaybackEventInput",
  {
    fields: (t) => ({
      eventId: t.string({ required: true }),
      kind: t.string({ required: true }),
      occurredAt: t.string({ required: true }),
      payload: t.field({ type: "JSON", required: true }),
    }),
  },
)

const EvidenceReceiptRef = builder.objectRef<RecommendationEvidenceReceipt>(
  "RecommendationEvidenceReceipt",
)
EvidenceReceiptRef.implement({
  fields: (t) => ({
    eventId: t.exposeString("eventId", { nullable: false }),
    status: t.exposeString("status", { nullable: false }),
  }),
})

const PlaybackReceiptRef = builder.objectRef<RecommendationPlaybackReceipt>(
  "RecommendationPlaybackReceipt",
)
PlaybackReceiptRef.implement({
  fields: (t) => ({
    eventId: t.exposeString("eventId", { nullable: false }),
    status: t.exposeString("status", { nullable: false }),
    sequence: t.exposeInt("sequence", { nullable: false }),
  }),
})

const ContentActionReceiptRef =
  builder.objectRef<RecommendationContentActionReceipt>(
    "RecommendationContentActionReceipt",
  )
ContentActionReceiptRef.implement({
  fields: (t) => ({
    actionId: t.exposeID("actionId", { nullable: false }),
    eventId: t.exposeString("eventId", { nullable: false }),
    status: t.exposeString("status", { nullable: false }),
    matched: t.exposeBoolean("matched", { nullable: false }),
    late: t.exposeBoolean("late", { nullable: false }),
  }),
})

const SelectionReceiptRef = builder.objectRef<SelectionReceipt>(
  "SemanticRecommendationSelectionReceipt",
)
SelectionReceiptRef.implement({
  fields: (t) => ({
    status: t.exposeString("status", { nullable: false }),
    claimNonce: t.exposeString("claimNonce", { nullable: true }),
    canonicalHref: t.exposeString("canonicalHref", { nullable: false }),
    targetMediaId: t.exposeID("targetMediaId", { nullable: false }),
  }),
})

const EpisodeClaimRef = builder.objectRef<EpisodeClaim>(
  "SemanticRecommendationEpisodeClaim",
)
EpisodeClaimRef.implement({
  fields: (t) => ({
    contextId: t.exposeID("contextId", { nullable: false }),
    episodeId: t.exposeID("episodeId", { nullable: false }),
    capability: t.exposeString("capability", { nullable: false }),
    activeUntil: t.exposeString("activeUntil", { nullable: false }),
    hardUntil: t.exposeString("hardUntil", { nullable: false }),
  }),
})

const PlaybackContextClaimRef =
  builder.objectRef<RecommendationPlaybackContextClaim>(
    "RecommendationPlaybackContextClaim",
  )
PlaybackContextClaimRef.implement({
  fields: (t) => ({
    contextId: t.exposeID("contextId", { nullable: false }),
    episodeId: t.exposeID("episodeId", { nullable: false }),
    capability: t.exposeString("capability", { nullable: false }),
    activeUntil: t.exposeString("activeUntil", { nullable: false }),
    hardUntil: t.exposeString("hardUntil", { nullable: false }),
    source: t.exposeString("source", { nullable: false }),
  }),
})

function evidenceKind(kind: string): "render" | "impression" {
  if (kind !== "render" && kind !== "impression") {
    throw new RecommendationInputError(
      "Recommendation evidence kind is invalid",
    )
  }
  return kind
}

function evidencePayload(payload: unknown): Record<string, unknown> {
  if (
    payload == null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new RecommendationInputError(
      "Recommendation evidence payload must be an object",
    )
  }
  return payload as Record<string, unknown>
}

builder.mutationFields((t) => ({
  recordSemanticRecommendationEvidence: t.field({
    type: [EvidenceReceiptRef],
    nullable: false,
    authScopes: { public: true },
    args: {
      contractVersion: t.arg.string({ required: true }),
      capability: t.arg.string({ required: true }),
      requestId: t.arg.id({ required: true }),
      itemId: t.arg.id({ required: true }),
      sessionDigest: t.arg.string({ required: true }),
      events: t.arg({
        type: [RecommendationEvidenceEventInput],
        required: true,
      }),
    },
    resolve: (_root, args, ctx) =>
      resolveRecommendationOperation(() =>
        createRecommendationEvidenceService(prisma).record({
          caller: ctx.user,
          contractVersion: args.contractVersion,
          capability: args.capability,
          requestId: String(args.requestId),
          itemId: String(args.itemId),
          sessionDigest: args.sessionDigest,
          events: args.events.map((event) => ({
            eventId: event.eventId,
            kind: evidenceKind(event.kind),
            occurredAt: event.occurredAt,
            payload: evidencePayload(event.payload),
          })),
        }),
      ),
  }),

  selectSemanticRecommendation: t.field({
    type: SelectionReceiptRef,
    nullable: false,
    authScopes: { public: true },
    args: {
      contractVersion: t.arg.string({ required: true }),
      capability: t.arg.string({ required: true }),
      requestId: t.arg.id({ required: true }),
      itemId: t.arg.id({ required: true }),
      sessionDigest: t.arg.string({ required: true }),
      eventId: t.arg.string({ required: true }),
      occurredAt: t.arg.string({ required: true }),
      tabDigest: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      resolveRecommendationOperation(() =>
        createRecommendationEpisodeService(prisma).select({
          caller: ctx.user,
          contractVersion: args.contractVersion,
          capability: args.capability,
          requestId: String(args.requestId),
          itemId: String(args.itemId),
          sessionDigest: args.sessionDigest,
          eventId: args.eventId,
          occurredAt: args.occurredAt,
          tabDigest: args.tabDigest,
        }),
      ),
  }),

  claimSemanticRecommendationEpisode: t.field({
    type: EpisodeClaimRef,
    nullable: false,
    authScopes: { public: true },
    args: {
      sessionDigest: t.arg.string({ required: true }),
      claimNonce: t.arg.string({ required: true }),
      mediaId: t.arg.id({ required: true }),
    },
    resolve: (_root, args, ctx) =>
      resolveRecommendationOperation(() =>
        createRecommendationEpisodeService(prisma).claim({
          caller: ctx.user,
          sessionDigest: args.sessionDigest,
          claimNonce: args.claimNonce,
          mediaId: String(args.mediaId),
        }),
      ),
  }),

  openRecommendationPlaybackContext: t.field({
    type: PlaybackContextClaimRef,
    nullable: false,
    authScopes: { public: true },
    args: {
      contractVersion: t.arg.string({ required: true }),
      sessionDigest: t.arg.string({ required: true }),
      mediaId: t.arg.id({ required: true }),
      idempotencyKey: t.arg.string({ required: true }),
      source: t.arg.string({ required: true }),
      sourceRef: t.arg.string({ required: false }),
      claimNonce: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      resolveRecommendationOperation(() =>
        createRecommendationPlaybackContextService(prisma).open({
          caller: ctx.user,
          contractVersion: args.contractVersion,
          sessionDigest: args.sessionDigest,
          mediaId: String(args.mediaId),
          idempotencyKey: args.idempotencyKey,
          source: args.source,
          sourceRef: args.sourceRef,
          claimNonce: args.claimNonce,
        }),
      ),
  }),

  recordSemanticRecommendationPlayback: t.field({
    type: [PlaybackReceiptRef],
    nullable: false,
    authScopes: { public: true },
    args: {
      contractVersion: t.arg.string({ required: true }),
      capability: t.arg.string({ required: true }),
      contextId: t.arg.id({ required: false }),
      episodeId: t.arg.id({ required: true }),
      sessionDigest: t.arg.string({ required: true }),
      mediaId: t.arg.id({ required: true }),
      events: t.arg({
        type: [RecommendationPlaybackEventInput],
        required: true,
      }),
    },
    resolve: (_root, args, ctx) =>
      resolveRecommendationOperation(() =>
        createRecommendationPlaybackService(prisma).record({
          caller: ctx.user,
          contractVersion: args.contractVersion,
          capability: args.capability,
          contextId:
            args.contextId == null ? undefined : String(args.contextId),
          episodeId: String(args.episodeId),
          sessionDigest: args.sessionDigest,
          mediaId: String(args.mediaId),
          events: args.events,
        }),
      ),
  }),

  recordRecommendationContentAction: t.field({
    type: ContentActionReceiptRef,
    nullable: false,
    authScopes: { public: true },
    args: {
      contractVersion: t.arg.string({ required: true }),
      sessionDigest: t.arg.string({ required: true }),
      eventId: t.arg.string({ required: true }),
      occurredAt: t.arg.string({ required: true }),
      mediaId: t.arg.id({ required: true }),
      actionKind: t.arg.string({ required: true }),
      actionDetail: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      resolveRecommendationOperation(() =>
        createRecommendationContentActionService(prisma).record({
          caller: ctx.user,
          contractVersion: args.contractVersion,
          sessionDigest: args.sessionDigest,
          eventId: args.eventId,
          occurredAt: args.occurredAt,
          mediaId: String(args.mediaId),
          actionClass: "human_action",
          actionKind: args.actionKind,
          actorClass: "human_anonymous",
          purpose: "watch",
          actionDetail: args.actionDetail ?? null,
          destination: null,
        }),
      ),
  }),
}))
