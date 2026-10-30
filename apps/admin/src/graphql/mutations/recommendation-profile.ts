/** @classification public-shape */
import { builder } from "@/graphql/builder"
import { prisma } from "@/db/client"
import { resolveRecommendationOperation } from "@/graphql/recommendation-errors"
import {
  createRecommendationProfileService,
  type RecommendationProfileReceipt,
} from "@/services/recommendations/profile.service"

type PublicProfileReceipt = Omit<
  RecommendationProfileReceipt,
  "profileId" | "erasureGeneration"
>

const ProfileReceiptRef = builder.objectRef<PublicProfileReceipt>(
  "RecommendationProfileReceipt",
)
ProfileReceiptRef.implement({
  fields: (t) => ({
    state: t.exposeString("state", { nullable: false }),
    choice: t.exposeString("choice", { nullable: false }),
    privacyGeneration: t.exposeInt("privacyGeneration", { nullable: true }),
    expiresAt: t.exposeString("expiresAt", { nullable: true }),
    erasureState: t.exposeString("erasureState", { nullable: true }),
    cookieDisposition: t.exposeString("cookieDisposition", { nullable: false }),
    consentChoice: t.exposeString("consentChoice", { nullable: false }),
    consentContractVersion: t.exposeString("consentContractVersion", {
      nullable: false,
    }),
    consentExpiresAt: t.exposeString("consentExpiresAt", { nullable: true }),
    consentCookieDisposition: t.exposeString("consentCookieDisposition", {
      nullable: false,
    }),
  }),
})

function publicReceipt(
  receipt: RecommendationProfileReceipt,
): PublicProfileReceipt {
  return {
    state: receipt.state,
    choice: receipt.choice,
    privacyGeneration: receipt.privacyGeneration,
    expiresAt: receipt.expiresAt,
    erasureState: receipt.erasureState,
    cookieDisposition: receipt.cookieDisposition,
    consentChoice: receipt.consentChoice,
    consentContractVersion: receipt.consentContractVersion,
    consentExpiresAt: receipt.consentExpiresAt,
    consentCookieDisposition: receipt.consentCookieDisposition,
  }
}

builder.mutationFields((t) => ({
  recommendationProfileStatus: t.field({
    type: ProfileReceiptRef,
    nullable: false,
    authScopes: { public: true },
    args: {
      contractVersion: t.arg.string({ required: true }),
      consentContractVersion: t.arg.string({ required: false }),
      sessionDigest: t.arg.string({ required: true }),
      consentReceiptDigest: t.arg.string({ required: false }),
      profileDigest: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      resolveRecommendationOperation(async () => {
        const service = createRecommendationProfileService(prisma)
        const receipt = await service.status({
          caller: ctx.user,
          contractVersion: args.contractVersion,
          consentContractVersion: args.consentContractVersion ?? undefined,
          sessionDigest: args.sessionDigest,
          consentReceiptDigest: args.consentReceiptDigest ?? null,
          profileDigest: args.profileDigest ?? null,
        })
        return publicReceipt(receipt)
      }),
  }),

  transitionRecommendationProfile: t.field({
    type: ProfileReceiptRef,
    nullable: false,
    authScopes: { public: true },
    args: {
      contractVersion: t.arg.string({ required: true }),
      consentContractVersion: t.arg.string({ required: false }),
      action: t.arg.string({ required: true }),
      consentChoice: t.arg.string({ required: false }),
      sessionDigest: t.arg.string({ required: true }),
      existingConsentReceiptDigest: t.arg.string({ required: false }),
      proposedConsentReceiptDigest: t.arg.string({ required: false }),
      existingProfileDigest: t.arg.string({ required: false }),
      proposedProfileDigest: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      resolveRecommendationOperation(async () => {
        const service = createRecommendationProfileService(prisma)
        const receipt = await service.transition({
          caller: ctx.user,
          contractVersion: args.contractVersion,
          consentContractVersion: args.consentContractVersion ?? undefined,
          action: args.action as "grant" | "reset" | "withdraw" | "delete",
          consentChoice: args.consentChoice as
            | "essential_only"
            | "personalization"
            | undefined,
          sessionDigest: args.sessionDigest,
          existingConsentReceiptDigest:
            args.existingConsentReceiptDigest ?? null,
          proposedConsentReceiptDigest:
            args.proposedConsentReceiptDigest ?? null,
          existingProfileDigest: args.existingProfileDigest ?? null,
          proposedProfileDigest: args.proposedProfileDigest ?? null,
        })
        return publicReceipt(receipt)
      }),
  }),
}))
