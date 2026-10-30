import { Prisma } from "@prisma/client"
import { RecommendationConflictError } from "./errors"

export const RECOMMENDATION_RETENTION_DEPENDENCY_LIMIT = 50_000
const limit = RECOMMENDATION_RETENTION_DEPENDENCY_LIMIT + 1

export type RetentionRoots = {
  requestIds?: string[]
  episodeIds?: string[]
  evaluationIds?: string[]
  assignmentIds?: string[]
  experimentIds?: string[]
  ownerReleaseIds?: string[]
}

type Dependencies = Record<
  | "requests"
  | "episodes"
  | "outcomes"
  | "eligibility"
  | "protocols"
  | "releases"
  | "studies"
  | "assignments"
  | "experiments",
  string[]
>

/** The retained request/playback/experiment closure remains bounded and
 * rechecked after locks. Retired profile and co-watch roots no longer exist.
 */
async function dependencies(
  tx: Prisma.TransactionClient,
  roots: RetentionRoots,
): Promise<Dependencies> {
  const [result] = await tx.$queryRaw<
    Array<Dependencies & { overflow: boolean }>
  >(Prisma.sql`
    WITH selected_assignments AS MATERIALIZED (
      SELECT id, experiment_id FROM recommendation_experiment_assignment
      WHERE id = ANY(${roots.assignmentIds ?? []}::text[])
        OR experiment_id = ANY(${roots.experimentIds ?? []}::text[])
      LIMIT ${limit}
    ), assignment_requests AS MATERIALIZED (
      SELECT id FROM recommendation_request
      WHERE experiment_assignment_id IN (SELECT id FROM selected_assignments)
      LIMIT ${limit}
    ), affected_requests AS MATERIALIZED (
      SELECT unnest(${roots.requestIds ?? []}::text[]) AS id
      UNION SELECT id FROM assignment_requests
      LIMIT ${limit}
    ), affected_episodes AS MATERIALIZED (
      SELECT id FROM recommendation_playback_episode
      WHERE request_id IN (SELECT id FROM affected_requests)
        OR id = ANY(${roots.episodeIds ?? []}::text[])
      LIMIT ${limit}
    ), affected_outcomes AS MATERIALIZED (
      SELECT id FROM recommendation_outcome_revision
      WHERE request_id IN (SELECT id FROM affected_requests)
        OR episode_id IN (SELECT id FROM affected_episodes)
      LIMIT ${limit}
    ), affected_runs AS MATERIALIZED (
      SELECT id FROM recommendation_shadow_run
      WHERE request_id IN (SELECT id FROM affected_requests)
        OR evaluation_id = ANY(${roots.evaluationIds ?? []}::text[])
      LIMIT ${limit}
    ), affected_protocols AS MATERIALIZED (
      SELECT id FROM recommendation_composition_protocol
      WHERE shadow_evaluation_id = ANY(${roots.evaluationIds ?? []}::text[])
      LIMIT ${limit}
    )
    SELECT
      ((SELECT count(*) FROM selected_assignments) >= ${limit}
        OR (SELECT count(*) FROM assignment_requests) >= ${limit}
        OR (SELECT count(*) FROM affected_episodes) >= ${limit}
        OR (SELECT count(*) FROM affected_outcomes) >= ${limit}
        OR (SELECT count(*) FROM affected_runs) >= ${limit}
        OR (SELECT count(*) FROM affected_protocols) >= ${limit}) AS overflow,
      ARRAY(SELECT id FROM affected_requests) AS requests,
      ARRAY(SELECT id FROM affected_episodes) AS episodes,
      ARRAY(SELECT id FROM affected_outcomes) AS outcomes,
      ARRAY(SELECT id FROM recommendation_eligibility_decision
        WHERE outcome_id IN (SELECT id FROM affected_outcomes)
        LIMIT ${limit}) AS eligibility,
      ARRAY(SELECT id::text FROM affected_protocols) AS protocols,
      ARRAY(SELECT id::text FROM recommendation_owner_release
        WHERE id = ANY(${roots.ownerReleaseIds ?? []}::uuid[])
        LIMIT ${limit}) AS releases,
      ARRAY(SELECT unnest(${roots.experimentIds ?? []}::text[])
        UNION SELECT experiment_id FROM selected_assignments) AS studies,
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

/** Lock selected retained roots in stable order and reject a growing closure. */
export async function lockRetentionRoots(
  tx: Prisma.TransactionClient,
  roots: RetentionRoots,
): Promise<void> {
  const planned = await dependencies(tx, roots)
  const tables = {
    requests: "recommendation_request",
    episodes: "recommendation_playback_episode",
    outcomes: "recommendation_outcome_revision",
    eligibility: "recommendation_eligibility_decision",
    protocols: "recommendation_composition_protocol",
    releases: "recommendation_owner_release",
    studies: "recommendation_study",
    assignments: "recommendation_experiment_assignment",
    experiments: "recommendation_experiment",
  } as const
  for (const key of Object.keys(tables) as Array<keyof Dependencies>) {
    if (planned[key].length === 0) continue
    const column = Prisma.raw(key === "studies" ? "experiment_id" : "id")
    await tx.$queryRaw(Prisma.sql`SELECT ${column} FROM ${Prisma.raw(tables[key])}
      WHERE ${column} = ANY(${planned[key]}::${Prisma.raw(key === "protocols" || key === "releases" ? "uuid[]" : "text[]")})
      ORDER BY ${column} FOR UPDATE ${Prisma.raw(key === "assignments" || key === "experiments" ? "NOWAIT" : "")}`)
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
