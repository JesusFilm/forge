/** @classification public-shape */
import { builder } from "@/graphql/builder"
import { prisma } from "@/db/client"
import {
  createRecommendationDeliveryService,
  type SemanticRecommendationDelivery,
  type SemanticRecommendationDeliveryItem,
  type RecommendationPersonalizationDelivery,
} from "@/services/recommendations/delivery.service"
import { assertWebRecommendationCaller } from "@/services/recommendations/caller"
import { resolveRecommendationOperation } from "@/graphql/recommendation-errors"
import type { RecommendationCandidateContributor } from "@/services/recommendations/contracts"

const ContributorRef = builder.objectRef<RecommendationCandidateContributor>(
  "RecommendationCandidateContributor",
)
ContributorRef.implement({
  fields: (t) => ({
    generator: t.exposeString("generator", { nullable: false }),
    generatorVersion: t.exposeString("generatorVersion", { nullable: false }),
    rank: t.exposeInt("rank", { nullable: false }),
  }),
})

const ItemRef = builder.objectRef<SemanticRecommendationDeliveryItem>(
  "SemanticRecommendationDeliveryItem",
)
ItemRef.implement({
  fields: (t) => ({
    id: t.exposeID("id", { nullable: false }),
    position: t.exposeInt("position", { nullable: false }),
    targetMediaId: t.exposeID("targetMediaId", { nullable: false }),
    canonicalHref: t.exposeString("canonicalHref", { nullable: false }),
    candidateGenerator: t.exposeString("candidateGenerator", {
      nullable: false,
    }),
    contributors: t.field({
      type: [ContributorRef],
      nullable: false,
      resolve: (item) => item.contributors,
    }),
    capability: t.exposeString("capability", { nullable: false }),
    videoSlug: t.exposeString("videoSlug", { nullable: false }),
    videoTitle: t.exposeString("videoTitle", { nullable: false }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    sceneIndex: t.exposeInt("sceneIndex", { nullable: false }),
    description: t.exposeString("description", { nullable: false }),
    startSeconds: t.exposeFloat("startSeconds", { nullable: false }),
    endSeconds: t.exposeFloat("endSeconds", { nullable: true }),
    durationSeconds: t.exposeFloat("durationSeconds", { nullable: true }),
    similarity: t.exposeFloat("similarity", { nullable: false }),
    themes: t.exposeStringList("themes", { nullable: false }),
    demographics: t.exposeStringList("demographics", { nullable: false }),
    spiritualContext: t.exposeStringList("spiritualContext", {
      nullable: false,
    }),
    playbackId: t.exposeString("playbackId", { nullable: false }),
  }),
})

const PersonalizationRef =
  builder.objectRef<RecommendationPersonalizationDelivery>(
    "RecommendationPersonalizationDelivery",
  )
PersonalizationRef.implement({
  fields: (t) => ({
    contractVersion: t.exposeString("contractVersion", { nullable: false }),
    lane: t.exposeString("lane", { nullable: false }),
    executionMode: t.exposeString("executionMode", { nullable: true }),
    effectiveManifestId: t.exposeString("effectiveManifestId", {
      nullable: false,
    }),
    profileState: t.exposeString("profileState", { nullable: true }),
    projectionVersion: t.exposeString("projectionVersion", { nullable: true }),
    projectionGeneration: t.exposeInt("projectionGeneration", {
      nullable: true,
    }),
    interestCount: t.exposeInt("interestCount", { nullable: false }),
    sessionIntentPresent: t.exposeBoolean("sessionIntentPresent", {
      nullable: false,
    }),
    reason: t.exposeString("reason", { nullable: true }),
  }),
})

const DeliveryRef = builder.objectRef<SemanticRecommendationDelivery>(
  "SemanticRecommendationDelivery",
)
DeliveryRef.implement({
  fields: (t) => ({
    contractVersion: t.exposeString("contractVersion", { nullable: false }),
    surfaceVersion: t.exposeString("surfaceVersion", { nullable: false }),
    strategyVersion: t.exposeString("strategyVersion", { nullable: false }),
    classifierVersion: t.exposeString("classifierVersion", {
      nullable: false,
    }),
    requestId: t.exposeID("requestId", { nullable: true }),
    result: t.exposeString("result", { nullable: false }),
    reason: t.exposeString("reason", { nullable: true }),
    expiresAt: t.exposeString("expiresAt", { nullable: true }),
    requestedCount: t.exposeInt("requestedCount", { nullable: true }),
    composedCount: t.exposeInt("composedCount", { nullable: true }),
    shortfallReason: t.exposeString("shortfallReason", { nullable: true }),
    items: t.field({
      type: [ItemRef],
      nullable: false,
      resolve: (delivery) => delivery.items,
    }),
    personalization: t.field({
      type: PersonalizationRef,
      nullable: true,
      resolve: (delivery) => delivery.personalization ?? null,
    }),
  }),
})

builder.queryFields((t) => ({
  semanticRecommendationDelivery: t.field({
    type: DeliveryRef,
    nullable: false,
    authScopes: { public: true },
    args: {
      seedMediaId: t.arg.id({ required: true }),
      locale: t.arg.string({ required: true }),
      audioLanguageSlug: t.arg.string({ required: true }),
      sessionDigest: t.arg.string({ required: true }),
      consentReceiptDigest: t.arg.string({ required: false }),
      profileTokenDigest: t.arg.string({ required: false }),
      eligibleHuman: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      return resolveRecommendationOperation(async () => {
        assertWebRecommendationCaller(ctx.user)
        return createRecommendationDeliveryService(prisma).deliver({
          caller: ctx.user,
          seedMediaId: String(args.seedMediaId),
          locale: args.locale,
          audioLanguageSlug: args.audioLanguageSlug,
          sessionDigest: args.sessionDigest,
          consentReceiptDigest: args.consentReceiptDigest ?? null,
          profileTokenDigest: args.profileTokenDigest ?? null,
          eligibleHuman: args.eligibleHuman ?? true,
        })
      })
    },
  }),
}))
