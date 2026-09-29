import type { PrismaClient } from "@prisma/client"
import { COWATCH_FROZEN_TRIAL_MODE } from "../cowatch/trial-authority.service"
import { runRecommendationRetrievalQuery } from "../delivery-runtime"
import { composeMmrSlate, MMR_SLATE_POLICY_VERSION } from "./mmr"
import {
  compositionDigest,
  hasMissingInput,
  compositionInputAvailability,
} from "./policy"
import {
  resolveCompositionQualification,
  type CompositionBinding,
} from "./service"

export type CompositionStudyAuthority = Readonly<{
  binding: CompositionBinding
  contextDigest: string
  experimentId: string
  experimentGeneration: number
  studyProtocolDigest: string
  challengerManifestId: string
  validUntil: Date
}>

/**
 * Internal server seam: U4 must resolve current persisted study authority for
 * the exact request context. Never expose this callback or accept a client flag.
 * Revalidate the returned binding at issuance if serving work crosses a fence.
 */
export async function composeAuthorizedMmrSlate(input: {
  prisma: PrismaClient
  binding: CompositionBinding
  slate: Parameters<typeof composeMmrSlate>[0]
  historyAvailable: boolean
  deadlineMs: number
  verifyStudyAuthority: (input: {
    binding: CompositionBinding
    context: Parameters<typeof composeMmrSlate>[0]["context"]
    contextDigest: string
    deadlineMs: number
  }) => Promise<CompositionStudyAuthority | null>
  now?: Date
}) {
  const startedAt = Date.now()
  const now = input.now ?? new Date(startedAt)
  const currentNow = () =>
    new Date(now.getTime() + Math.max(0, Date.now() - startedAt))
  const hasCowatchInput =
    Boolean(input.binding.cowatchGenerationId) ||
    input.slate.ordered
      .slice(0, 64)
      .some((candidate) =>
        candidate.nominations.some(
          (nomination) => nomination.source.generator === "directional-cowatch",
        ),
      )
  const fallback = (reason: string) => ({
    status: "fallback" as const,
    result: composeMmrSlate({
      ...input.slate,
      // The caller executes the exact incumbent on fallback. Never leak graph
      // candidates from an input whose live authority could not be verified.
      ordered: hasCowatchInput ? [] : input.slate.ordered,
      policyVersion: "deterministic-composition-fallback",
    }),
    provenance: {
      composerVersion: "deterministic-composition-fallback",
      reason,
      compositionProtocolId: input.binding.protocolId,
    },
  })
  if (Date.now() >= input.deadlineMs) return fallback("composition_deadline")
  if (input.slate.editorial)
    return fallback("editorial_adapter_outside_supported_subset")
  if (
    input.binding.composerVersion !== MMR_SLATE_POLICY_VERSION ||
    (input.slate.policyVersion &&
      input.slate.policyVersion !== MMR_SLATE_POLICY_VERSION)
  )
    return fallback("composition_version_mismatch")
  if (
    input.slate.ordered
      .slice(0, 64)
      .some((candidate) =>
        candidate.nominations.some(
          (nomination) =>
            nomination.source.generator === "directional-cowatch" &&
            (!input.binding.cowatchGenerationId ||
              nomination.source.generatorVersion !==
                COWATCH_FROZEN_TRIAL_MODE ||
              nomination.source.evidence.generation !==
                input.binding.cowatchGenerationId),
        ),
      )
  )
    return fallback("composition_candidate_graph_mismatch")
  const result = composeMmrSlate(input.slate)
  if (
    hasMissingInput(
      compositionInputAvailability(result, input.historyAvailable),
    )
  )
    return fallback("composition_required_input_unavailable")
  let authority: CompositionStudyAuthority | null
  const contextDigest = compositionDigest(input.slate.context)
  try {
    const qualification = await runRecommendationRetrievalQuery(
      input.prisma,
      input.deadlineMs,
      (tx) => resolveCompositionQualification(tx, input.binding, currentNow()),
    )
    if (!qualification) return fallback("composition_qualification_unavailable")
    const remaining = input.deadlineMs - Date.now()
    if (remaining <= 0) return fallback("composition_deadline")
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      authority = await Promise.race([
        input.verifyStudyAuthority({
          binding: input.binding,
          context: input.slate.context,
          contextDigest,
          deadlineMs: input.deadlineMs,
        }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), remaining)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (
      !authority ||
      compositionDigest(authority.binding) !==
        compositionDigest(input.binding) ||
      authority.contextDigest !== contextDigest ||
      authority.challengerManifestId !== input.binding.manifestId ||
      !(authority.validUntil instanceof Date) ||
      !Number.isFinite(authority.validUntil.getTime()) ||
      authority.validUntil <= currentNow() ||
      authority.validUntil > qualification.validUntil ||
      !authority.experimentId ||
      authority.experimentId.length > 191 ||
      !Number.isSafeInteger(authority.experimentGeneration) ||
      authority.experimentGeneration < 1 ||
      !/^[a-f0-9]{64}$/.test(authority.studyProtocolDigest)
    )
      return fallback("composition_study_authority_unavailable")
    // Recheck after the external authority read: revocation may have committed
    // while it was awaiting U4. Both reads remain constant-size and deadline-bound.
    if (
      !(await runRecommendationRetrievalQuery(
        input.prisma,
        input.deadlineMs,
        (tx) =>
          resolveCompositionQualification(tx, input.binding, currentNow()),
      ))
    )
      return fallback("composition_qualification_revoked")
  } catch {
    return fallback("composition_authority_unavailable")
  }
  if (Date.now() >= input.deadlineMs) return fallback("composition_deadline")
  return {
    status: "composed" as const,
    result,
    provenance: {
      composerVersion: MMR_SLATE_POLICY_VERSION,
      compositionProtocolId: input.binding.protocolId,
      compositionEvidenceDigest: input.binding.evidenceDigest,
      compositionReviewDigest: input.binding.reviewDigest,
      compositionAuthorityRevision: input.binding.authorityRevision,
      cowatchGenerationId: input.binding.cowatchGenerationId ?? null,
      experimentId: authority.experimentId,
      experimentGeneration: authority.experimentGeneration,
      studyProtocolDigest: authority.studyProtocolDigest,
    },
  }
}
