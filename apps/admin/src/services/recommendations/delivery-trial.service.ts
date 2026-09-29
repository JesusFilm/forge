import type { PrismaClient } from "@prisma/client"
import { env } from "@/config/env"
import type {
  CandidateNomination,
  RecommendationCandidateContext,
} from "./candidate"
import { composeAuthorizedMmrSlate } from "./composition/live"
import { compositionDigest } from "./composition/policy"
import { createDatabaseCowatchLiveSource } from "./cowatch/live.service"
import { mergeBoundedCowatchNominations } from "./delivery-candidate-mapping"
import { runRecommendationDeliveryTransaction } from "./delivery-runtime"
import type { ExperimentAssignmentContext } from "./experiment/assignment"
import {
  readActiveStudyAuthority,
  activeStudyAuthorityDigest,
  type ActiveStudyAuthority,
} from "./experiment/active-study-authority"
import {
  applyMmrComposition,
  runCandidatePlatform,
  type CandidatePlatformResult,
} from "./orchestration"
import { COWATCH_MMR_GENERATOR_SET_VERSION } from "./promotion/manifest"
import type { RecommendationRecentContext } from "./recent-context.service"
import type { ViewingModeAffinity } from "./viewing-mode"
import { loadViewingModeAffinity } from "./viewing-mode.service"

export type TrialCompositionInput = Readonly<{
  assignment: ExperimentAssignmentContext
  authority: ActiveStudyAuthority
  context: RecommendationCandidateContext
  seedMediaId: string
  profileProjectionId: string
  profileTokenDigest: string
  semanticNominations: readonly CandidateNomination[]
  profileNominations: readonly CandidateNomination[]
  recentContext: RecommendationRecentContext
  limit: number
  deadlineAt: number
  now: Date
}>
export type TrialCompositionResult =
  | {
      status: "composed"
      platform: CandidatePlatformResult
      viewingMode: ViewingModeAffinity | null
    }
  | { status: "fallback"; reason: string }

export function resolveDeliveryStudyAuthority(
  prisma: PrismaClient,
  input: {
    assignment: ExperimentAssignmentContext
    deadlineAt: number
    now: Date
  },
) {
  return runRecommendationDeliveryTransaction(
    prisma,
    input.deadlineAt,
    (tx) => readActiveStudyAuthority(tx, input),
    Date.now,
  )
}

/** One request's bounded challenger path. Failure returns to its real incumbent. */
export async function composeDeliveryCowatchTrial(
  prisma: PrismaClient,
  input: TrialCompositionInput,
): Promise<TrialCompositionResult> {
  const startedAt = Date.now()
  const now = () =>
    new Date(input.now.getTime() + Math.max(0, Date.now() - startedAt))
  const expected = input.authority
  if (
    expected.execution !== "cowatch_mmr" ||
    !expected.cowatch ||
    !expected.composition
  )
    return { status: "fallback", reason: "trial_authority_incomplete" }
  const requestContextDigest = compositionDigest({
    assignment: input.assignment,
    context: input.context,
    seedMediaId: input.seedMediaId,
    profileProjectionId: input.profileProjectionId,
  })
  const readCurrent = async () => {
    const current = await resolveDeliveryStudyAuthority(prisma, {
      assignment: input.assignment,
      deadlineAt: input.deadlineAt,
      now: now(),
    })
    return current &&
      activeStudyAuthorityDigest(current) ===
        activeStudyAuthorityDigest(expected)
      ? current
      : null
  }
  try {
    const graph = await createDatabaseCowatchLiveSource(prisma, {
      now,
      resolveActiveAuthority: async (context) => {
        if (context.requestContextDigest !== requestContextDigest) return null
        const current = await readCurrent()
        return current?.cowatch
          ? {
              binding: current.cowatch,
              validUntil: current.validUntil,
              requestContextDigest,
            }
          : null
      },
    })({
      seedMediaId: input.seedMediaId,
      locale: input.context.locale,
      audioLanguageSlug: input.context.audioLanguageSlug,
      profileProjectionId: input.profileProjectionId,
      requestContextDigest,
      deadlineAt: input.deadlineAt,
    })
    if (graph.disposition !== "candidate")
      return {
        status: "fallback",
        reason: graph.fallbackReason ?? "cowatch_source_unavailable",
      }
    const composition = expected.composition
    const provenance = {
      compositionProtocolId: composition.protocolId,
      compositionEvidenceDigest: composition.evidenceDigest,
      compositionReviewDigest: composition.reviewDigest,
      compositionAuthorityRevision: composition.authorityRevision,
      graphGenerationId: expected.cowatch.graphGenerationId,
      experimentId: expected.experimentId,
      experimentGeneration: expected.experimentGeneration,
      studyProtocolDigest: expected.protocolDigest,
    }
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
    const slateContext = {
      currentVideoId: input.seedMediaId,
      recentVideos: input.recentContext.videos,
    }
    const platform = runCandidatePlatform({
      nominations,
      context: input.context,
      viewingMode,
      limit: input.limit,
      generatorVersion: COWATCH_MMR_GENERATOR_SET_VERSION,
      composition: slateContext,
    })
    const composed = await composeAuthorizedMmrSlate({
      prisma,
      binding: composition,
      slate: {
        ordered: platform.ordered,
        context: input.context,
        limit: input.limit,
        composition: slateContext,
      },
      historyAvailable: true,
      deadlineMs: input.deadlineAt,
      now: now(),
      verifyStudyAuthority: async ({ contextDigest }) => {
        if (contextDigest !== compositionDigest(input.context)) return null
        const current = await readCurrent()
        return current?.composition
          ? {
              binding: current.composition,
              contextDigest,
              experimentId: current.experimentId,
              experimentGeneration: current.experimentGeneration,
              studyProtocolDigest: current.protocolDigest,
              challengerManifestId: current.challengerManifestId,
              validUntil: current.validUntil,
            }
          : null
      },
    })
    if (composed.status !== "composed")
      return {
        status: "fallback",
        reason: composed.provenance.reason ?? "composition_unavailable",
      }
    const authorized = applyMmrComposition(platform, composed.result)
    return {
      status: "composed",
      viewingMode,
      platform: {
        ...authorized,
        // Run authority is shared by the slate. Retain it once in the first
        // composed observation, in both legacy and compact trace formats,
        // rather than repeating it across every source and candidate stage.
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
    return {
      status: "fallback",
      reason:
        Date.now() >= input.deadlineAt
          ? "trial_deadline"
          : "trial_source_unavailable",
    }
  }
}
