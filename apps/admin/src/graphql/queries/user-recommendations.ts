/** @classification public-shape */
import { builder } from "@/graphql/builder"
import { prisma } from "@/db/client"
import { env } from "@/config/env"
import { resolveRecommendationOperation } from "@/graphql/recommendation-errors"
import { resolveRecommendationIdentity } from "@/services/recommendations/viewer-identity.service"
import {
  createUserRecommendationDeliveryService,
  type UserRecommendationDelivery,
  type UserRecommendationItem,
} from "@/services/recommendations/user-delivery.service"

const ItemRef = builder.objectRef<UserRecommendationItem>(
  "UserRecommendationItem",
)
ItemRef.implement({
  fields: (t) => ({
    id: t.exposeID("id", { nullable: false }),
    position: t.exposeInt("position", { nullable: false }),
    targetMediaId: t.exposeID("targetMediaId", { nullable: false }),
    canonicalHref: t.exposeString("canonicalHref", { nullable: false }),
    capability: t.exposeString("capability", { nullable: false }),
    videoSlug: t.exposeString("videoSlug", { nullable: false }),
    videoTitle: t.exposeString("videoTitle", { nullable: false }),
    imageUrl: t.exposeString("imageUrl"),
    description: t.exposeString("description", { nullable: false }),
    durationSeconds: t.exposeFloat("durationSeconds"),
    generator: t.exposeString("generator", { nullable: false }),
    poolVersion: t.exposeString("poolVersion"),
    poolKey: t.exposeString("poolKey"),
  }),
})
const DeliveryRef = builder.objectRef<UserRecommendationDelivery>(
  "UserRecommendationDelivery",
)
DeliveryRef.implement({
  fields: (t) => ({
    contractVersion: t.exposeString("contractVersion", { nullable: false }),
    surfaceVersion: t.exposeString("surfaceVersion", { nullable: false }),
    requestId: t.exposeID("requestId"),
    result: t.exposeString("result", { nullable: false }),
    reason: t.exposeString("reason"),
    expiresAt: t.exposeString("expiresAt"),
    requestedCount: t.exposeInt("requestedCount", { nullable: false }),
    profileCount: t.exposeInt("profileCount", { nullable: false }),
    curatedCount: t.exposeInt("curatedCount", { nullable: false }),
    cohort: t.exposeString("cohort", { nullable: false }),
    poolVersion: t.exposeString("poolVersion"),
    items: t.field({
      type: [ItemRef],
      nullable: false,
      resolve: (delivery) => delivery.items,
    }),
  }),
})
builder.queryFields((t) => ({
  userRecommendations: t.field({
    type: DeliveryRef,
    nullable: false,
    authScopes: { public: true },
    args: {
      locale: t.arg.string({ required: true }),
      audioLanguageSlug: t.arg.string({ required: true }),
      count: t.arg.int(),
      viewerToken: t.arg.string(),
      sessionToken: t.arg.string(),
      sessionDigest: t.arg.string(),
      consentReceiptDigest: t.arg.string(),
      profileTokenDigest: t.arg.string(),
    },
    resolve: (_root, args, ctx) =>
      resolveRecommendationOperation(async () => {
        const identity = await resolveRecommendationIdentity(
          prisma,
          ctx.user,
          args,
        )
        return createUserRecommendationDeliveryService(
          prisma,
          env.RECOMMENDATION_USER_SERVING_ENABLED === "true",
        ).deliver({
          ...identity,
          locale: args.locale,
          audioLanguageSlug: args.audioLanguageSlug,
          count: args.count ?? 6,
          consentReceiptDigest: args.viewerToken
            ? identity.consentReceiptDigest
            : args.consentReceiptDigest,
          profileTokenDigest: args.viewerToken
            ? identity.profileTokenDigest
            : args.profileTokenDigest,
        })
      }),
  }),
}))
