import { Prisma } from "@prisma/client"
import { RecommendationConflictError } from "../errors"
import { cowatchSourceInvalidSql } from "./lineage"
import {
  COWATCH_DURABLE_LINEAGE_VERSION,
  COWATCH_FEATURE_VERSION,
  COWATCH_PROJECTION_VERSION,
} from "./graph"
import {
  assertCowatchSourceWindow,
  COWATCH_SOURCE_WINDOW_VERSION,
} from "./source-window"

/** Full scan only at operator qualification; never on the serving path. */
export async function qualifyOwnerReleaseGraph(
  tx: Prisma.TransactionClient,
  graphGenerationId: string,
  now: Date,
) {
  if (!/^[a-f0-9]{64}$/.test(graphGenerationId))
    throw new RecommendationConflictError("owner_release_graph_invalid")
  await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`
  await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`
  await tx.$queryRaw`SELECT id FROM recommendation_cowatch_generation WHERE id = ${graphGenerationId}::char(64) FOR UPDATE`
  // The floor participates in source eligibility. Legacy stop holds the pointer
  // before its slate-fence triggers invalidate graphs. Yield immediately to that
  // stop rather than holding this graph while waiting for its pointer lock.
  await tx.$queryRaw`SELECT id FROM recommendation_promotion_pointer WHERE id = 'recommendation-promotion-pointer' FOR SHARE NOWAIT`
  const pointer = await tx.recommendationPromotionPointer.findUnique({
    where: { id: "recommendation-promotion-pointer" },
  })
  const graph = await tx.recommendationCowatchGeneration.findUnique({
    where: { id: graphGenerationId },
  })
  if (
    !pointer ||
    !graph ||
    graph.invalidatedAt ||
    graph.expiresAt <= now ||
    graph.publishedAt > now ||
    graph.publishedAt.getTime() + 86_400_000 <= now.getTime() ||
    graph.lineageVersion !== COWATCH_DURABLE_LINEAGE_VERSION ||
    graph.featureVersion !== COWATCH_FEATURE_VERSION ||
    graph.projectionVersion !== COWATCH_PROJECTION_VERSION ||
    graph.sourceWindowVersion !== COWATCH_SOURCE_WINDOW_VERSION ||
    !graph.windowStart ||
    !graph.evaluationAsOf ||
    graph.evaluationAsOf > graph.publishedAt ||
    graph.rawSourceCount == null ||
    graph.rawSourceCount < graph.sourceCount ||
    graph.rawSourceCount > 50_000 ||
    graph.attemptedPairCount == null ||
    graph.attemptedPairCount < graph.contributionCount ||
    graph.attemptedPairCount > 250_000 ||
    graph.sourceCount < 1 ||
    graph.sourceCount > 50_000 ||
    graph.contributionCount < 1 ||
    graph.contributionCount > 250_000 ||
    graph.edgeCount < 1 ||
    graph.edgeCount > 250_000
  )
    throw new RecommendationConflictError("owner_release_graph_unavailable")
  assertCowatchSourceWindow(
    {
      version: COWATCH_SOURCE_WINDOW_VERSION,
      windowStart: graph.windowStart,
      windowEnd: graph.windowEnd,
      evaluationAsOf: graph.evaluationAsOf,
    },
    now,
  )
  // One-use identity is retained independently of raw graph deletion.
  if (
    await tx.recommendationOwnerRelease.findUnique({
      where: { graphGenerationId },
      select: { id: true },
    })
  )
    throw new RecommendationConflictError(
      "owner_release_graph_already_qualified",
    )
  const [source] = await tx.$queryRaw<
    Array<{
      count: bigint
      invalid: bigint
      earliest: Date | null
      rawExpiry: Date | null
    }>
  >(Prisma.sql`
    SELECT COUNT(*)::bigint AS count,
      COUNT(*) FILTER (WHERE ${cowatchSourceInvalidSql(now, graph.lineageVersion)})::bigint AS invalid,
      MIN(LEAST(source_row.expires_at, outcome.expires_at, episode.expires_at, decision.expires_at, profile.expires_at)) AS earliest,
      MAX(GREATEST(source_row.expires_at, outcome.expires_at, episode.expires_at)) AS "rawExpiry"
    FROM recommendation_cowatch_source_contribution source_row
    JOIN recommendation_outcome_revision outcome ON outcome.id = source_row.outcome_id
    JOIN recommendation_playback_episode episode ON episode.id = outcome.episode_id
    LEFT JOIN recommendation_profile profile ON profile.id = source_row.viewer_profile_id
    LEFT JOIN recommendation_eligibility_decision decision ON decision.id = source_row.eligibility_decision_id
    LEFT JOIN recommendation_cowatch_suppression suppression ON suppression.episode_id = episode.id
    WHERE source_row.generation_id = ${graphGenerationId}::char(64)`)
  const [pairs] = await tx.$queryRaw<
    Array<{ count: bigint; earliest: Date | null }>
  >`
    SELECT COUNT(*)::bigint AS count, MIN(expires_at) AS earliest
    FROM recommendation_cowatch_contribution WHERE generation_id = ${graphGenerationId}::char(64)`
  const [edges] = await tx.$queryRaw<
    Array<{ count: bigint; supported: bigint }>
  >`
    SELECT COUNT(*)::bigint AS count, COUNT(*) FILTER (WHERE eligible)::bigint AS supported
    FROM recommendation_cowatch_edge WHERE generation_id = ${graphGenerationId}::char(64)`
  if (
    !source?.earliest ||
    !source.rawExpiry ||
    !pairs?.earliest ||
    !edges ||
    Number(source.count) !== graph.sourceCount ||
    Number(source.invalid) !== 0 ||
    Number(pairs.count) !== graph.contributionCount ||
    Number(edges.count) !== graph.edgeCount ||
    Number(edges.supported) < 1
  )
    throw new RecommendationConflictError("owner_release_graph_lineage_invalid")
  const dependencyExpiresAt = new Date(
    Math.min(
      graph.expiresAt.getTime(),
      source.earliest.getTime(),
      pairs.earliest.getTime(),
    ),
  )
  const validUntil = new Date(
    Math.min(
      dependencyExpiresAt.getTime(),
      graph.publishedAt.getTime() + 86_400_000,
    ),
  )
  if (validUntil <= now)
    throw new RecommendationConflictError("owner_release_graph_expired")
  return {
    graph,
    dependencyExpiresAt,
    validUntil,
    rawPopulationExpiresAt: source.rawExpiry,
    ownerInfluenceFloorGeneration: pointer.ownerInfluenceFloorGeneration,
  }
}
