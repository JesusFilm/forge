import { Prisma } from "@prisma/client"
import { RecommendationConflictError } from "../errors"
import {
  COWATCH_DURABLE_LINEAGE_VERSION,
  COWATCH_FEATURE_VERSION,
  COWATCH_PROJECTION_VERSION,
} from "../cowatch/graph"
import { cowatchSourceInvalidSql } from "../cowatch/lineage"
import { COWATCH_SOURCE_WINDOW_VERSION } from "../cowatch/source-window"

/** Full source verification is restricted to preparation/decision/calibration.
 * The graph lock precedes protocol locks, matching the invalidation triggers.
 * No discovery link is required after durable privacy lineage was captured.
 */
export async function validateCompositionGraph(
  tx: Prisma.TransactionClient,
  generationId: string,
  now: Date,
) {
  await tx.$queryRaw`SELECT id FROM recommendation_cowatch_generation WHERE id = ${generationId}::char(64) FOR SHARE`
  const graph = await tx.recommendationCowatchGeneration.findUnique({
    where: { id: generationId },
  })
  if (
    !graph ||
    graph.invalidatedAt ||
    graph.expiresAt <= now ||
    graph.publishedAt > now ||
    now.getTime() - graph.publishedAt.getTime() > 86_400_000 ||
    graph.lineageVersion !== COWATCH_DURABLE_LINEAGE_VERSION ||
    graph.projectionVersion !== COWATCH_PROJECTION_VERSION ||
    graph.featureVersion !== COWATCH_FEATURE_VERSION ||
    graph.sourceWindowVersion !== COWATCH_SOURCE_WINDOW_VERSION ||
    !graph.windowStart ||
    !graph.evaluationAsOf ||
    graph.windowStart >= graph.windowEnd ||
    graph.windowEnd > graph.evaluationAsOf ||
    graph.evaluationAsOf > graph.publishedAt
  )
    throw new RecommendationConflictError("composition_graph_unavailable")
  const [source] = await tx.$queryRaw<
    Array<{ count: bigint; invalid: bigint; earliest: Date | null }>
  >(Prisma.sql`
    SELECT COUNT(*)::bigint AS count,
      COUNT(*) FILTER (WHERE ${cowatchSourceInvalidSql(now, graph.lineageVersion)})::bigint AS invalid,
      MIN(LEAST(source_row.expires_at, outcome.expires_at, episode.expires_at, decision.expires_at, profile.expires_at)) AS earliest
    FROM recommendation_cowatch_source_contribution source_row
    JOIN recommendation_outcome_revision outcome ON outcome.id = source_row.outcome_id
    JOIN recommendation_playback_episode episode ON episode.id = outcome.episode_id
    LEFT JOIN recommendation_profile profile ON profile.id = source_row.viewer_profile_id
    LEFT JOIN recommendation_eligibility_decision decision ON decision.id = source_row.eligibility_decision_id
    LEFT JOIN recommendation_cowatch_suppression suppression ON suppression.episode_id = episode.id
    WHERE source_row.generation_id = ${generationId}
  `)
  const [pairs] = await tx.$queryRaw<
    Array<{ count: bigint; earliest: Date | null }>
  >`
    SELECT COUNT(*)::bigint AS count, MIN(expires_at) AS earliest
    FROM recommendation_cowatch_contribution WHERE generation_id = ${generationId}`
  const [edges] = await tx.$queryRaw<
    Array<{ count: bigint; supported: bigint }>
  >`
    SELECT COUNT(*)::bigint AS count, COUNT(*) FILTER (WHERE eligible)::bigint AS supported
    FROM recommendation_cowatch_edge WHERE generation_id = ${generationId}`
  if (
    !source?.earliest ||
    !pairs?.earliest ||
    Number(source.invalid) !== 0 ||
    Number(source.count) !== graph.sourceCount ||
    Number(pairs.count) !== graph.contributionCount ||
    Number(edges?.count) !== graph.edgeCount ||
    Number(edges?.supported) < 1
  )
    throw new RecommendationConflictError("composition_graph_lineage_invalid")
  const expiresAt = new Date(
    Math.min(
      graph.expiresAt.getTime(),
      source.earliest.getTime(),
      pairs.earliest.getTime(),
    ),
  )
  if (expiresAt <= now)
    throw new RecommendationConflictError("composition_graph_expired")
  return { graph, expiresAt }
}
