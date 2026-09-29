import { Prisma, type PrismaClient } from "@prisma/client"
import type { CandidateNomination } from "../candidate"
import { buildCowatchNominations } from "./candidate.service"
import {
  compatibleCowatchFeature,
  COWATCH_FEATURE_VERSION,
  type CowatchFeature,
} from "./graph"
import {
  chooseCowatchAnchors,
  loadValidatedCowatchProfileInterests,
} from "./inspection.service"
import {
  COWATCH_FROZEN_TRIAL_MODE,
  cowatchTrialBindingDigest,
  readCowatchTrialAuthority,
  type CowatchTrialBinding,
  type CowatchTrialRefusal,
} from "./trial-authority.service"

export type CowatchLiveContext = Readonly<{
  seedMediaId: string
  locale: string
  audioLanguageSlug: string
  profileProjectionId: string | null
  requestContextDigest: string
  deadlineAt: number
}>
export type CowatchActiveTrialAuthority = Readonly<{
  binding: CowatchTrialBinding
  validUntil: Date
  requestContextDigest: string
}>
export type CowatchLiveFallback =
  | CowatchTrialRefusal
  | "cowatch_active_authority_unavailable"
  | "cowatch_request_context_mismatch"
  | "cowatch_deadline_exceeded"
  | "cowatch_source_error"
  | "cowatch_unplayable"
export type CowatchLiveResult = Readonly<{
  disposition: "candidate" | "fallback"
  nominations: CandidateNomination[]
  fallbackReason: CowatchLiveFallback | null
  provenance: Readonly<{
    mode: typeof COWATCH_FROZEN_TRIAL_MODE
    graphGenerationId: string
    bindingDigest: string
    studyId: string
    experimentGeneration: number
    manifestId: string
    manifestDigest: string
    protocolDigest: string
    shadowEvaluationId: string
    shadowDecisionId: string
    trialValidUntil: Date
    dependencyExpiresAt: Date
  }> | null
}>

/** Server-only factory. The active study/assignment resolver is injected by
 * delivery orchestration; clients cannot enable frozen serving with a flag.
 * Issuance must recheck readCowatchTrialAuthority and active study authority in
 * its own transaction. No historical liveItems enter this candidate source.
 */
export function createDatabaseCowatchLiveSource(
  prisma: PrismaClient,
  deps: {
    resolveActiveAuthority: (
      context: CowatchLiveContext,
    ) => Promise<CowatchActiveTrialAuthority | null>
    now?: () => Date
  },
): (context: CowatchLiveContext) => Promise<CowatchLiveResult> {
  const now = deps.now ?? (() => new Date())
  const fallback = (reason: CowatchLiveFallback): CowatchLiveResult => ({
    disposition: "fallback",
    nominations: [],
    fallbackReason: reason,
    provenance: null,
  })
  return async (context) => {
    const remaining = () => Math.floor(context.deadlineAt - Date.now())
    if (remaining() <= 0) return fallback("cowatch_deadline_exceeded")
    let timer: ReturnType<typeof setTimeout> | undefined
    const work = async (): Promise<CowatchLiveResult> => {
      const active = await deps.resolveActiveAuthority(context)
      if (!active || active.validUntil <= now())
        return fallback("cowatch_active_authority_unavailable")
      if (
        !/^[a-f0-9]{64}$/.test(context.requestContextDigest) ||
        active.requestContextDigest !== context.requestContextDigest
      )
        return fallback("cowatch_request_context_mismatch")
      if (remaining() <= 0) return fallback("cowatch_deadline_exceeded")
      const binding = active.binding
      const retrieved = await prisma.$transaction<CowatchLiveResult>(
        async (tx) => {
          await tx.$queryRaw`SELECT set_config('statement_timeout', ${`${Math.max(1, remaining())}ms`}, true), set_config('lock_timeout', '50ms', true)`
          const current = await readCowatchTrialAuthority(tx, binding, now())
          if (current.status !== "current") return fallback(current.reason)
          const interests = await loadValidatedCowatchProfileInterests(
            tx,
            context.profileProjectionId,
            now(),
          )
          const anchors = chooseCowatchAnchors({
            seedMediaId: context.seedMediaId,
            interests,
          })
          const rows = await tx.$queryRaw<CowatchFeature[]>(Prisma.sql`
          SELECT ${COWATCH_FEATURE_VERSION}::text AS "contractVersion", edge.generation_id AS generation,
            edge.source_media_id AS "sourceMediaId", edge.target_media_id AS "targetMediaId",
            edge.session_support AS "sessionSupport", edge.distinct_viewer_support AS "distinctViewerSupport",
            edge.confidence, edge.popularity_corrected_lift AS "popularityCorrectedLift",
            edge.recency_weight AS "recencyWeight", edge.quality_weight AS "qualityWeight",
            edge.effective_weight AS "effectiveWeight", edge.contamination, edge.eligible
          FROM unnest(ARRAY[${Prisma.join(anchors.map((anchor) => anchor.mediaId))}]::text[]) anchor(media_id)
          CROSS JOIN LATERAL (
            SELECT * FROM recommendation_cowatch_edge
            WHERE generation_id = ${binding.graphGenerationId} AND source_media_id = anchor.media_id AND eligible
            ORDER BY confidence DESC, popularity_corrected_lift DESC, target_media_id LIMIT 32
          ) edge
          ORDER BY edge.confidence DESC, edge.popularity_corrected_lift DESC, edge.target_media_id LIMIT 32
        `)
          const candidates = rows
            .filter(
              (edge) =>
                compatibleCowatchFeature(edge, binding.graphGenerationId) &&
                !anchors.some(
                  (anchor) => anchor.mediaId === edge.targetMediaId,
                ),
            )
            .slice(0, 12)
          if (candidates.length === 0)
            return fallback("cowatch_supported_edges_sparse")
          const bindingDigest = cowatchTrialBindingDigest(binding)
          const nominations = await buildCowatchNominations(
            tx,
            candidates,
            anchors,
            context,
            COWATCH_FROZEN_TRIAL_MODE,
            {
              bindingDigest,
              studyId: binding.studyId,
              experimentGeneration: binding.experimentGeneration,
              manifestId: binding.manifestId,
              manifestDigest: binding.manifestDigest,
              protocolDigest: binding.protocolDigest,
              shadowEvaluationId: binding.shadowEvaluationId,
              shadowDecisionId: binding.shadowDecisionId,
              trialValidUntil: binding.trialValidUntil.toISOString(),
            },
          )
          if (remaining() <= 0) return fallback("cowatch_deadline_exceeded")
          if (nominations.length === 0) return fallback("cowatch_unplayable")
          return {
            disposition: "candidate",
            nominations,
            fallbackReason: null,
            provenance: {
              mode: COWATCH_FROZEN_TRIAL_MODE,
              graphGenerationId: binding.graphGenerationId,
              bindingDigest,
              studyId: binding.studyId,
              experimentGeneration: binding.experimentGeneration,
              manifestId: binding.manifestId,
              manifestDigest: binding.manifestDigest,
              protocolDigest: binding.protocolDigest,
              shadowEvaluationId: binding.shadowEvaluationId,
              shadowDecisionId: binding.shadowDecisionId,
              trialValidUntil: binding.trialValidUntil,
              dependencyExpiresAt: current.authority.dependencyExpiresAt,
            },
          }
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: Math.max(1, Math.min(250, remaining())),
          timeout: Math.max(1, remaining()),
        },
      )
      if (retrieved.disposition === "fallback") return retrieved
      // Release our DB connection before an external registry callback: its
      // own reads must not queue behind a pool full of suspended live readers.
      const refreshed = await deps.resolveActiveAuthority(context)
      if (
        !refreshed ||
        refreshed.validUntil <= now() ||
        cowatchTrialBindingDigest(refreshed.binding) !==
          cowatchTrialBindingDigest(binding)
      )
        return fallback("cowatch_active_authority_unavailable")
      if (refreshed.requestContextDigest !== context.requestContextDigest)
        return fallback("cowatch_request_context_mismatch")
      if (remaining() <= 0) return fallback("cowatch_deadline_exceeded")
      return prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT set_config('statement_timeout', ${`${Math.max(1, remaining())}ms`}, true), set_config('lock_timeout', '50ms', true)`
          const finalAuthority = await readCowatchTrialAuthority(
            tx,
            binding,
            now(),
          )
          return finalAuthority.status === "current"
            ? retrieved
            : fallback(finalAuthority.reason)
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: Math.max(1, Math.min(250, remaining())),
          timeout: Math.max(1, remaining()),
        },
      )
    }
    try {
      return await Promise.race([
        work(),
        new Promise<CowatchLiveResult>((resolve) => {
          timer = setTimeout(
            () => resolve(fallback("cowatch_deadline_exceeded")),
            Math.max(1, remaining()),
          )
        }),
      ])
    } catch {
      return fallback(
        remaining() <= 0 ? "cowatch_deadline_exceeded" : "cowatch_source_error",
      )
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
