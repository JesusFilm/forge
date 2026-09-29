import { Prisma } from "@prisma/client"
import { RecommendationConflictError } from "./errors"

export const RECOMMENDATION_RETENTION_DEPENDENCY_LIMIT = 50_000
const limit = RECOMMENDATION_RETENTION_DEPENDENCY_LIMIT + 1

export type RetentionRoots = {
  requestIds?: string[]
  episodeIds?: string[]
  profileIds?: string[]
  graphIds?: string[]
  evaluationIds?: string[]
  assignmentIds?: string[]
  experimentIds?: string[]
}
type Dependencies = Record<
  | "profiles"
  | "requests"
  | "episodes"
  | "outcomes"
  | "eligibility"
  | "sources"
  | "graphs"
  | "protocols"
  | "studies"
  | "assignments"
  | "experiments",
  string[]
>

async function dependencies(
  tx: Prisma.TransactionClient,
  roots: RetentionRoots,
) {
  const [result] = await tx.$queryRaw<
    Array<Dependencies & { overflow: boolean }>
  >(Prisma.sql`
    WITH selected_assignments AS MATERIALIZED (
      SELECT id, profile_id, experiment_id FROM recommendation_experiment_assignment
      WHERE id = ANY(${roots.assignmentIds ?? []}::text[]) OR experiment_id = ANY(${roots.experimentIds ?? []}::text[]) OR profile_id = ANY(${roots.profileIds ?? []}::text[])
      LIMIT ${limit}
    ), assignment_requests AS MATERIALIZED (
      SELECT id FROM recommendation_request WHERE experiment_assignment_id IN (SELECT id FROM selected_assignments) LIMIT ${limit}
    ), root_sessions AS MATERIALIZED (
      SELECT session_digest FROM recommendation_profile_session_link WHERE profile_id = ANY(${roots.profileIds ?? []}::text[])
      UNION SELECT session_digest FROM recommendation_cowatch_source_contribution WHERE viewer_profile_id = ANY(${roots.profileIds ?? []}::text[])
      LIMIT ${limit}
    ), seed_sources AS MATERIALIZED (
      SELECT source.id, source.generation_id, source.viewer_profile_id, source.session_digest, source.outcome_id FROM recommendation_cowatch_source_contribution source
      WHERE source.generation_id = ANY(${roots.graphIds ?? []}::char(64)[])
      UNION
      SELECT source.id, source.generation_id, source.viewer_profile_id, source.session_digest, source.outcome_id FROM recommendation_cowatch_source_contribution source
      WHERE source.viewer_profile_id = ANY(${roots.profileIds ?? []}::text[])
      UNION
      SELECT source.id, source.generation_id, source.viewer_profile_id, source.session_digest, source.outcome_id FROM recommendation_cowatch_source_contribution source
      JOIN root_sessions session ON source.session_digest = session.session_digest
      UNION
      SELECT source.id, source.generation_id, source.viewer_profile_id, source.session_digest, source.outcome_id FROM recommendation_cowatch_source_contribution source
      JOIN recommendation_outcome_revision outcome ON outcome.id = source.outcome_id
      WHERE outcome.request_id = ANY(${roots.requestIds ?? []}::text[])
        OR outcome.episode_id = ANY(${roots.episodeIds ?? []}::text[])
      LIMIT ${limit}
    ), root_sources AS MATERIALIZED (
      SELECT source.id, source.generation_id, source.viewer_profile_id, source.session_digest, source.outcome_id
      FROM recommendation_cowatch_source_contribution source
      WHERE source.outcome_id IN (SELECT outcome_id FROM seed_sources) LIMIT ${limit}
    ), affected_episodes AS MATERIALIZED (
      SELECT id FROM recommendation_playback_episode WHERE request_id = ANY(${roots.requestIds ?? []}::text[])
        OR id = ANY(${roots.episodeIds ?? []}::text[])
      UNION SELECT outcome.episode_id FROM root_sources source JOIN recommendation_outcome_revision outcome ON outcome.id = source.outcome_id
      UNION SELECT episode.id FROM recommendation_playback_episode episode JOIN (
        SELECT DISTINCT session_digest FROM root_sources WHERE viewer_profile_id IS NOT NULL
      ) source ON source.session_digest = episode.session_digest
      LIMIT ${limit}
    ), affected_outcomes AS MATERIALIZED (
      SELECT id FROM recommendation_outcome_revision WHERE episode_id IN (SELECT id FROM affected_episodes) LIMIT ${limit}
    ), affected_sources AS MATERIALIZED (
      SELECT id, generation_id, viewer_profile_id FROM recommendation_cowatch_source_contribution
      WHERE outcome_id IN (SELECT id FROM affected_outcomes) LIMIT ${limit}
    ), affected_runs AS MATERIALIZED (
      SELECT projection_profile_id, request_id, id FROM recommendation_shadow_run
      WHERE request_id = ANY(${roots.requestIds ?? []}::text[])
        OR projection_profile_id = ANY(${roots.profileIds ?? []}::text[])
        OR evaluation_id = ANY(${roots.evaluationIds ?? []}::text[]) LIMIT ${limit}
    )
    SELECT
      ((SELECT count(*) FROM root_sessions) >= ${limit} OR (SELECT count(*) FROM selected_assignments) >= ${limit} OR (SELECT count(*) FROM assignment_requests) >= ${limit} OR (SELECT count(*) FROM seed_sources) >= ${limit} OR (SELECT count(*) FROM root_sources) >= ${limit} OR (SELECT count(*) FROM affected_episodes) >= ${limit}
        OR (SELECT count(*) FROM affected_outcomes) >= ${limit} OR (SELECT count(*) FROM affected_sources) >= ${limit}
        OR (SELECT count(*) FROM affected_runs) >= ${limit}) AS overflow,
      ARRAY(SELECT unnest(${roots.profileIds ?? []}::text[]) UNION SELECT viewer_profile_id FROM root_sources WHERE viewer_profile_id IS NOT NULL
        UNION SELECT projection_profile_id FROM affected_runs WHERE projection_profile_id IS NOT NULL
        UNION SELECT profile_id FROM selected_assignments WHERE profile_id IS NOT NULL) AS profiles,
      ARRAY(SELECT unnest(${roots.requestIds ?? []}::text[]) UNION SELECT request_id FROM affected_runs UNION SELECT id FROM assignment_requests) AS requests,
      ARRAY(SELECT id FROM affected_episodes) AS episodes,
      ARRAY(SELECT id FROM affected_outcomes) AS outcomes,
      ARRAY(SELECT id FROM recommendation_eligibility_decision WHERE outcome_id IN (SELECT id FROM affected_outcomes) LIMIT ${limit}) AS eligibility,
      ARRAY(SELECT id FROM affected_sources) AS sources,
      ARRAY(SELECT unnest(${roots.graphIds ?? []}::text[]) UNION SELECT generation_id FROM affected_sources
        UNION SELECT protocol.config->>'cowatchGenerationId' FROM recommendation_composition_protocol protocol
          JOIN recommendation_composition_observation observation ON observation.protocol_id = protocol.id
          WHERE observation.run_id IN (SELECT id FROM affected_runs) AND protocol.config->>'cowatchGenerationId' IS NOT NULL
        UNION SELECT config->>'cowatchGenerationId' FROM recommendation_composition_protocol
          WHERE shadow_evaluation_id = ANY(${roots.evaluationIds ?? []}::text[]) AND config->>'cowatchGenerationId' IS NOT NULL) AS graphs,
      ARRAY(SELECT id::text FROM recommendation_composition_protocol WHERE shadow_evaluation_id = ANY(${roots.evaluationIds ?? []}::text[])) AS protocols,
      ARRAY(SELECT unnest(${roots.experimentIds ?? []}::text[]) UNION SELECT experiment_id FROM selected_assignments) AS studies,
      ARRAY(SELECT id FROM selected_assignments) AS assignments,
      ${roots.experimentIds ?? []}::text[] AS experiments
  `)
  if (
    !result ||
    result.overflow ||
    Object.entries(result).some(
      ([key, value]) =>
        key !== "overflow" &&
        Array.isArray(value) &&
        value.length > RECOMMENDATION_RETENTION_DEPENDENCY_LIMIT,
    )
  )
    throw new RecommendationConflictError(
      "Recommendation retention dependency limit exceeded; reduce the bounded batch",
    )
  return result
}

/** Lock only the selected roots' indexed dependency closure, never the catalog.
 * Suppressing a private source can invalidate sibling graphs sharing its episode
 * or session. Lock raw parents before graph/protocol revocation and recheck the
 * closure after locking, so a concurrent append cannot escape the planned set.
 */
export async function lockRetentionRoots(
  tx: Prisma.TransactionClient,
  roots: RetentionRoots,
) {
  const planned = await dependencies(tx, roots)
  const tables = {
    profiles: "recommendation_profile",
    requests: "recommendation_request",
    episodes: "recommendation_playback_episode",
    outcomes: "recommendation_outcome_revision",
    eligibility: "recommendation_eligibility_decision",
    sources: "recommendation_cowatch_source_contribution",
    graphs: "recommendation_cowatch_generation",
    protocols: "recommendation_composition_protocol",
    studies: "recommendation_study",
    assignments: "recommendation_experiment_assignment",
    experiments: "recommendation_experiment",
  } as const
  for (const key of Object.keys(tables) as Array<keyof Dependencies>) {
    if (planned[key].length === 0) continue
    const column = Prisma.raw(key === "studies" ? "experiment_id" : "id")
    await tx.$queryRaw(Prisma.sql`SELECT ${column} FROM ${Prisma.raw(tables[key])}
      WHERE ${column} = ANY(${planned[key]}::${Prisma.raw(key === "graphs" ? "char(64)[]" : key === "protocols" ? "uuid[]" : "text[]")}) ORDER BY ${column} FOR UPDATE ${Prisma.raw(key === "assignments" || key === "experiments" ? "NOWAIT" : "")}`)
  }
  const current = await dependencies(tx, roots)
  for (const key of Object.keys(tables) as Array<keyof Dependencies>) {
    const locked = new Set(planned[key])
    if (current[key].some((id) => !locked.has(id)))
      throw new RecommendationConflictError(
        "Recommendation retention dependencies changed; retry the bounded batch",
      )
  }
}
