import type { PrismaClient } from "@prisma/client"
import { env } from "@/config/env"
import {
  adaptSemanticCandidates,
  HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
} from "../candidate"
import { createDatabaseProfileSourceNominationGenerator } from "../candidates/profile-candidate.service"
import { DELIVERY_RETRIEVAL_BUDGET_MS, MAX_DELIVERY_ITEMS } from "../contracts"
import { createDatabaseCowatchShadowGenerator } from "../cowatch/candidate.service"
import {
  mergeBoundedCowatchNominations,
  mergeBoundedHybridNominations,
} from "../delivery-candidate-mapping"
import { getSemanticDeliveryCandidatePool } from "../delivery-retriever"
import { runRecommendationRetrievalQuery } from "../delivery-runtime"
import {
  runCandidatePlatform,
  runSemanticCandidatePlatform,
} from "../orchestration"
import { loadViewingModeAffinity } from "../viewing-mode.service"
import type { ShadowGenerator } from "./service"

/** The trial samples current inputs through the same bounded source/rank policy as delivery.
 * Historical served items remain the comparison row; they are never synthetic semantic inputs.
 */
export function createCowatchTrialShadowGenerator(
  prisma: PrismaClient,
  graphGenerationId: string,
  now = () => new Date(),
): ShadowGenerator {
  return async (context) => {
    const evaluatedAt = now()
    const deadlineAt = Date.now() + DELIVERY_RETRIEVAL_BUDGET_MS
    const unavailable = (reason: string) => ({
      nominations: [],
      projectionCapturedAt: null,
      cohortQuality: null,
      sourceFailureReason: reason,
    })
    if (context.history?.status !== "request_window_reconstruction")
      return unavailable("recent_context_unavailable")
    const composition = {
      currentVideoId: context.seedMediaId,
      recentVideos: context.history.recentVideos,
    }
    if (!context.seedMediaId || !context.contextProjection.ref) {
      return {
        nominations: [],
        projectionCapturedAt: null,
        cohortQuality: null,
        sourceFailureReason: "trial_profile_context_unavailable",
      }
    }
    return runRecommendationRetrievalQuery(
      prisma,
      deadlineAt,
      async (scoped) => {
        // The wrapper supplies one Prisma transaction; these adapters perform
        // reads only and do not open nested transactions.
        const db = scoped as PrismaClient
        const projection =
          await db.recommendationProfileProjectionGeneration.findUnique({
            where: { id: context.contextProjection.ref! },
            include: { profile: true },
          })
        if (
          projection?.scope !== "DURABLE" ||
          projection.state !== "PUBLISHED" ||
          projection.expiresAt <= evaluatedAt ||
          projection.profile?.state !== "ACTIVE" ||
          !projection.profile.tokenDigest ||
          projection.profile.expiresAt <= evaluatedAt ||
          projection.profile.privacyGeneration !==
            context.contextProjection.privacyGeneration ||
          projection.privacyGeneration !==
            context.contextProjection.privacyGeneration
        ) {
          return {
            nominations: [],
            projectionCapturedAt: null,
            cohortQuality: null,
            sourceFailureReason: "trial_profile_context_unavailable",
          }
        }
        const [semantic, profile] = await Promise.all([
          getSemanticDeliveryCandidatePool(db, {
            seedMediaId: context.seedMediaId!,
            locale: context.locale,
            audioLanguageSlug: context.audioLanguageSlug,
            limit: MAX_DELIVERY_ITEMS,
          }),
          createDatabaseProfileSourceNominationGenerator(
            db,
            () => evaluatedAt,
          )(context),
        ])
        const semanticNominations = adaptSemanticCandidates(
          semantic,
          context,
        ).nominations
        const incumbentNominations = mergeBoundedHybridNominations(
          semanticNominations,
          profile.nominations,
        )
        // Match delivery's first mode read: only incumbent sources participate.
        // Missing mode evidence preserves ordinary relevance for the incumbent.
        const incumbentMode =
          env.RECOMMENDATION_VIEWING_MODE_ENABLED === "false"
            ? null
            : await loadViewingModeAffinity(db, {
                profileTokenDigest: projection.profile.tokenDigest,
                mediaIds: incumbentNominations.map((row) => row.targetMediaId),
                now: evaluatedAt,
              }).catch(() => null)
        let semanticPlatform: ReturnType<typeof runSemanticCandidatePlatform>
        try {
          semanticPlatform = runSemanticCandidatePlatform({
            candidates: semantic,
            context,
            limit: MAX_DELIVERY_ITEMS,
            composition,
            viewingMode: incumbentMode,
          })
        } catch {
          return unavailable("candidate_platform_unavailable")
        }
        if (
          semanticPlatform.parity.candidateEligibility === "failed" ||
          semanticPlatform.parity.ranker === "failed"
        )
          return unavailable("semantic_parity_mismatch")
        if (semanticPlatform.composed.length === 0)
          return unavailable("semantic_candidates_unavailable")
        if (profile.sourceFailureReason || profile.nominations.length === 0)
          return unavailable(
            profile.sourceFailureReason ?? "profile_candidates_sparse",
          )
        let incumbent: ReturnType<typeof runCandidatePlatform>
        try {
          incumbent = runCandidatePlatform({
            nominations: incumbentNominations,
            context,
            limit: MAX_DELIVERY_ITEMS,
            generatorVersion: HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
            composition,
            viewingMode: incumbentMode,
          })
        } catch {
          return unavailable("hybrid_candidate_platform_unavailable")
        }
        if (
          !incumbent.ordered.some((candidate) =>
            candidate.sources.some(
              (source) =>
                source.generator === "multi-interest-profile" &&
                source.rejectionReason == null,
            ),
          )
        )
          return unavailable("profile_candidates_sparse")
        if (incumbent.composed.length === 0)
          return unavailable("hybrid_slate_empty")
        // A failed incumbent remains a sampled failure. Never manufacture a
        // healthy bundle by letting co-watch fill a missing semantic source.
        const graph = await createDatabaseCowatchShadowGenerator(
          db,
          () => evaluatedAt,
          graphGenerationId,
        )(context)
        const nominations = mergeBoundedCowatchNominations(
          semanticNominations,
          profile.nominations,
          graph.nominations.filter(
            (row) => row.source.generator === "directional-cowatch",
          ),
        )
        const viewingMode =
          env.RECOMMENDATION_VIEWING_MODE_ENABLED === "false"
            ? null
            : await loadViewingModeAffinity(db, {
                profileTokenDigest: projection.profile.tokenDigest,
                mediaIds: nominations.map((row) => row.targetMediaId),
                now: evaluatedAt,
              })
        return {
          nominations,
          viewingMode,
          projectionCapturedAt: graph.projectionCapturedAt,
          cohortQuality: graph.cohortQuality,
          sourceFailureReason:
            profile.sourceFailureReason ?? graph.sourceFailureReason ?? null,
        }
      },
    )
  }
}
