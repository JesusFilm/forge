import { Prisma, type PrismaClient } from "@prisma/client"
import { env } from "@/config/env"
import type {
  CandidateNomination,
  RecommendationCandidateContext,
} from "./candidate"
import {
  composeStructurallyValidMmrSlate,
  type CompositionInputDiagnostic,
} from "./composition/live-structure"
import { compositionDigest } from "./composition/policy"
import { loadBoundedCowatchNominations } from "./cowatch/live.service"
import { mergeBoundedCowatchNominations } from "./delivery-candidate-mapping"
import { runRecommendationDeliveryTransaction } from "./delivery-runtime"
import {
  applyMmrComposition,
  runCandidatePlatform,
  type CandidatePlatformResult,
} from "./orchestration"
import { profileLineageEligibleSql } from "./profiles/profile-lineage"
import {
  readActiveOwnerRelease,
  directDeliveryAuthorityDigest,
  type DirectDeliveryAuthority,
} from "./promotion/owner-authority"
import {
  COWATCH_MMR_GENERATOR_SET_VERSION,
  COWATCH_OWNER_LIVE_MODE,
} from "./promotion/manifest"
import type { RecommendationRecentContext } from "./recent-context.service"
import type { ViewingModeAffinity } from "./viewing-mode"
import { loadViewingModeAffinity } from "./viewing-mode.service"

export type OwnerDeliveryAuthority = Readonly<{
  release: DirectDeliveryAuthority
  privacyGeneration: number
}>
type OwnerRequestProfile = Readonly<{
  profileProjectionId: string
  profileTokenDigest: string
  consentReceiptDigest: string
}>

/** Current server authority and exact requesting profile. No enrollment writes. */
export function resolveDeliveryOwnerAuthority(
  prisma: PrismaClient,
  input: OwnerRequestProfile & { now: Date; deadlineAt: number },
): Promise<OwnerDeliveryAuthority | null> {
  return runRecommendationDeliveryTransaction(
    prisma,
    input.deadlineAt,
    async (tx) => {
      const release = await readActiveOwnerRelease(tx, input.now)
      if (!release) return null
      const [profile] = await tx.$queryRaw<
        Array<{ privacyGeneration: number }>
      >(Prisma.sql`
      SELECT profile.privacy_generation AS "privacyGeneration"
      FROM recommendation_profile_projection_generation generation
      JOIN recommendation_profile_projection_pointer pointer ON pointer.generation_id = generation.id
      JOIN recommendation_profile profile ON profile.id = generation.profile_id
      JOIN recommendation_consent_receipt receipt ON receipt.profile_id = profile.id
      WHERE generation.id = ${input.profileProjectionId}
        AND generation.scope = 'durable' AND generation.state = 'published'
        AND generation.published_at <= ${input.now} AND generation.expires_at > ${input.now}
        AND generation.durable_interest_count > 0
        AND pointer.scope = 'durable' AND pointer.profile_id = profile.id
        AND pointer.privacy_generation = profile.privacy_generation
        AND generation.privacy_generation = profile.privacy_generation
        AND profile.token_digest = ${input.profileTokenDigest}
        AND profile.state = 'active' AND profile.choice = 'durable_allowed' AND profile.expires_at > ${input.now}
        AND receipt.token_digest = ${input.consentReceiptDigest}
        AND receipt.contract_version = 'recommendation-consent-v1'
        AND receipt.state = 'active' AND receipt.choice = 'personalization'
        AND receipt.privacy_generation = profile.privacy_generation AND receipt.expires_at > ${input.now}
        AND ${profileLineageEligibleSql(Prisma.sql`generation.id`, input.now)}
    `)
      return profile
        ? { release, privacyGeneration: profile.privacyGeneration }
        : null
    },
    Date.now,
  )
}

export type OwnerCompositionInput = OwnerRequestProfile &
  Readonly<{
    authority: OwnerDeliveryAuthority
    context: RecommendationCandidateContext
    seedMediaId: string
    semanticNominations: readonly CandidateNomination[]
    profileNominations: readonly CandidateNomination[]
    recentContext: RecommendationRecentContext
    limit: number
    deadlineAt: number
    now: Date
  }>
export type OwnerCompositionResult =
  | Readonly<{
      status: "composed"
      platform: CandidatePlatformResult
      viewingMode: ViewingModeAffinity | null
    }>
  | Readonly<{
      status: "fallback"
      reason: string
      compositionInputDiagnostic?: CompositionInputDiagnostic
    }>

/** Owner-approved execution has its own exact authority, never a fake study. */
export async function composeDeliveryOwnerCowatch(
  prisma: PrismaClient,
  input: OwnerCompositionInput,
): Promise<OwnerCompositionResult> {
  const startedAt = Date.now()
  const now = () =>
    new Date(input.now.getTime() + Math.max(0, Date.now() - startedAt))
  const expected = input.authority.release
  const fallback = (reason: string): OwnerCompositionResult => ({
    status: "fallback",
    reason,
  })
  const sameRelease = (current: DirectDeliveryAuthority | null) =>
    current &&
    directDeliveryAuthorityDigest(current) ===
      directDeliveryAuthorityDigest(expected)
  const requestContextDigest = compositionDigest({
    bindingDigest: expected.bindingDigest,
    releaseId: expected.releaseId,
    pointerGeneration: expected.pointerGeneration,
    context: input.context,
    seedMediaId: input.seedMediaId,
    profileProjectionId: input.profileProjectionId,
    privacyGeneration: input.authority.privacyGeneration,
  })
  try {
    const graph = await runRecommendationDeliveryTransaction(
      prisma,
      input.deadlineAt,
      async (tx) => {
        if (!sameRelease(await readActiveOwnerRelease(tx, now()))) return null
        return loadBoundedCowatchNominations(tx, {
          context: {
            ...input.context,
            seedMediaId: input.seedMediaId,
            profileProjectionId: input.profileProjectionId,
            requestContextDigest,
            deadlineAt: input.deadlineAt,
          },
          graphGenerationId: expected.graphGenerationId,
          generatorVersion: COWATCH_OWNER_LIVE_MODE,
          now: now(),
        })
      },
      Date.now,
    )
    if (!graph) return fallback("owner_authority_unavailable")
    if (graph.fallbackReason) return fallback(graph.fallbackReason)
    const nominations = mergeBoundedCowatchNominations(
      input.semanticNominations,
      input.profileNominations,
      graph.nominations,
    )
    const viewingMode =
      env.RECOMMENDATION_VIEWING_MODE_ENABLED === "false"
        ? null
        : await runRecommendationDeliveryTransaction(
            prisma,
            input.deadlineAt,
            (tx) =>
              loadViewingModeAffinity(tx, {
                profileTokenDigest: input.profileTokenDigest,
                mediaIds: nominations.map((row) => row.targetMediaId),
                now: now(),
              }),
            Date.now,
          )
    const platform = runCandidatePlatform({
      nominations,
      context: input.context,
      viewingMode,
      limit: input.limit,
      generatorVersion: COWATCH_MMR_GENERATOR_SET_VERSION,
      composition: {
        currentVideoId: input.seedMediaId,
        recentVideos: input.recentContext.videos,
      },
    })
    const composed = composeStructurallyValidMmrSlate({
      slate: {
        ordered: platform.ordered,
        context: input.context,
        limit: input.limit,
        composition: {
          currentVideoId: input.seedMediaId,
          recentVideos: input.recentContext.videos,
        },
      },
      historyAvailable: true,
      composerVersion: expected.binding.composerVersion,
      graphGenerationId: expected.graphGenerationId,
      graphGeneratorVersion: COWATCH_OWNER_LIVE_MODE,
    })
    if (composed.status !== "composed") return composed
    // No connection is held while acquiring a new bounded authority transaction.
    const current = await resolveDeliveryOwnerAuthority(prisma, {
      ...input,
      now: now(),
    })
    if (
      !current ||
      !sameRelease(current.release) ||
      current.privacyGeneration !== input.authority.privacyGeneration
    )
      return fallback("owner_authority_unavailable")
    if (Date.now() >= input.deadlineAt) return fallback("owner_deadline")
    const authorized = applyMmrComposition(platform, composed.result)
    const provenance = {
      ownerReleaseId: expected.releaseId,
      ownerReleaseGeneration: expected.pointerGeneration,
      ownerBindingDigest: expected.bindingDigest,
      ownerManifestId: expected.manifestId,
      ownerManifestDigest: expected.manifestDigest,
      ownerCompositionConfigDigest: expected.binding.compositionConfigDigest,
      ownerSourceMode: COWATCH_OWNER_LIVE_MODE,
      graphGenerationId: expected.graphGenerationId,
      ownerValidUntil: expected.validUntil.toISOString(),
      ownerDependencyExpiresAt: expected.dependencyExpiresAt.toISOString(),
      requestContextDigest,
    }
    return {
      status: "composed",
      viewingMode,
      platform: {
        ...authorized,
        evidence: authorized.evidence.map((entry) =>
          entry.stage === "composed" && entry.ordinal === 0
            ? {
                ...entry,
                sourceEvidence: entry.sourceEvidence.map((source, index) =>
                  index === 0
                    ? {
                        ...source,
                        evidence: { ...source.evidence, ...provenance },
                      }
                    : source,
                ),
              }
            : entry,
        ),
      },
    }
  } catch {
    return fallback(
      Date.now() >= input.deadlineAt
        ? "owner_deadline"
        : "owner_source_unavailable",
    )
  }
}
