// Scene embedding backfill — durable useworkflow job that indexes
// manager's scene-analysis artifacts into admin's Postgres.
//
// Flow:
//   1. stepLoadMapping        — load coreId → cms video id snapshot
//   2. stepEnumerateTargets   — list (video, edition, locale) triples
//                               where the locale is data-derived from
//                               the union of each video's primary
//                               language + edition-level subtitle
//                               languages + edition-level dub languages
//   3. stepIndexEditionLocale — per-target indexer call with isolated
//                               error handling
//   4. stepReport             — aggregate per-target outcomes
//
// Per-target errors are caught inside the loop so one bad artifact
// doesn't halt the whole backfill. The indexer itself is idempotent
// (upserts on composite keys), so the workflow is safe to re-run.
//
// Locale model: the default locale set is data-derived at enumeration
// time ("every locale that exists for this video") rather than a
// hardcoded list. An earlier prototype used
// `DEFAULT_LOCALES = ["en", "es", "fr"]`; dropped when the sibling R2
// surfaced the pattern as a class of bug. See
// docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md.
// The caller's `locales` filter, if supplied, narrows which BCP-47
// tags are processed; omitted means all data-derived locales.

import pLimit from "p-limit"
import { prisma } from "@/db/client"
import { SYSTEM_PRINCIPAL } from "@/auth/principal"
import { env } from "@/config/env"
import {
  loadCoreIdMapping,
  type CoreIdMapping,
} from "@/services/core-id-mapping.service"
import { ManagerArtifactError } from "@/services/manager-artifacts.service"
import {
  indexEditionScenes,
  type IndexEditionScenesResult,
} from "@/services/scene-embedding.service"

/**
 * Default per-target concurrency for the R1 scene-embedding backfill.
 * Override via `SCENE_EMBEDDING_CONCURRENCY` (env-validated, positive
 * int). Sized below admin's documented `connection_limit=10` Prisma
 * pool to leave headroom for concurrent GraphQL/REST traffic; local
 * dev can crank to 20+ via the env override.
 */
export const DEFAULT_SCENE_EMBEDDING_CONCURRENCY = 5

export type SceneEmbeddingBackfillInput = {
  /** S3 key of the JSON mapping snapshot uploaded via the admin refresh CLI. */
  mappingS3Key: string
  /** Restrict to these coreIds. Omitted = all mapped videos. */
  coreIds?: readonly string[]
  /**
   * Restrict to these locales (BCP-47). Omitted = every locale that
   * exists for the videos — the union of each video's primary
   * language, edition-level subtitle languages, and edition-level dub
   * languages, derived at enumeration time. No hardcoded
   * `["en", "es", "fr"]` default. See `stepEnumerateTargets` for the
   * derivation.
   */
  locales?: readonly string[]
}

export type BackfillTarget = {
  videoId: string
  videoEditionId: string
  coreId: string
  cmsVideoId: number
  /**
   * BCP-47 locale to be stamped on the `VideoSceneLocale` row. Derived
   * per enumeration: one target per `(videoEdition, locale)` pair where
   * the locale appears in any of the video's primary language, the
   * edition's subtitle languages, or the edition's dub languages. No
   * hardcoded fallback — if no language attestation exists for an
   * edition, the edition produces no targets.
   */
  locale: string
}

export type BackfillOutcome =
  | {
      status: "succeeded"
      target: BackfillTarget
      locale: string
      scenesIndexed: number
      embeddingsWritten: number
      durationMs: number
    }
  | {
      status: "skipped"
      target: BackfillTarget
      locale: string
      reason: string
      durationMs: number
    }
  | {
      status: "failed"
      target: BackfillTarget
      locale: string
      reason: string
      durationMs: number
    }

export type SceneEmbeddingBackfillReport = {
  mappingGeneratedAt: string
  totalTargets: number
  /**
   * The caller's locale filter (when provided) or `null` when the
   * enumeration used the full data-derived set. The actual set of
   * locales processed is visible via `outcomes[].locale`.
   */
  localeFilter: readonly string[] | null
  outcomes: BackfillOutcome[]
  succeeded: number
  skipped: number
  failed: number
}

export async function runSceneEmbeddingBackfill(
  input: SceneEmbeddingBackfillInput,
): Promise<SceneEmbeddingBackfillReport> {
  "use workflow"

  const mapping = await stepLoadMapping(input.mappingS3Key)
  // Treat length-0 arrays as "omitted" so a GraphQL caller who
  // accidentally passes `coreIds: []` / `locales: []` doesn't silently
  // run zero work with a success-shaped report. Matches the mutation
  // description's "Omitted = all mapped videos" / "Omitted = all
  // data-derived locales" contract.
  const coreIdsFilter =
    input.coreIds && input.coreIds.length > 0 ? input.coreIds : undefined
  const localeFilter =
    input.locales && input.locales.length > 0 ? new Set(input.locales) : null

  const allTargets = await stepEnumerateTargets(coreIdsFilter, mapping)
  const targets = localeFilter
    ? allTargets.filter((t) => localeFilter.has(t.locale))
    : allTargets

  // Bounded parallelism. `p-limit(N) + Promise.allSettled` is the
  // documented robustness shape — never bare `Promise.all` (one
  // rejection would abort the entire batch). See
  // docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md.
  // `stepIndexEditionLocale` already catches errors per-target and
  // returns a typed `failed` outcome; a settled `rejected` is
  // therefore unexpected (e.g. a throw inside `"use step"` plumbing).
  // The defensive branch in `limit(...)` below synthesizes a `failed`
  // outcome carrying the real elapsed batch time so dashboards built
  // on `outcomes[].durationMs` aren't polluted with `0`s.
  const concurrency =
    env.SCENE_EMBEDDING_CONCURRENCY ?? DEFAULT_SCENE_EMBEDDING_CONCURRENCY
  const limit = pLimit(concurrency)

  // Emit a structured start log so the workflow's effective
  // concurrency is observable from any trigger path (GraphQL mutation
  // or local CLI). Closes the agent-native gap where only the CLI
  // logged this previously.
  console.log(
    JSON.stringify({
      workflow: "scene-embedding-backfill",
      event: "start",
      mappingGeneratedAt: mapping.generatedAt,
      totalTargets: targets.length,
      concurrency,
      localeFilter:
        input.locales && input.locales.length > 0 ? input.locales : null,
    }),
  )

  // Per-completion logging streams progress as each target settles
  // (instead of bursting at the end), restoring the operational
  // visibility the sequential `for…of` had. `Promise.allSettled`
  // preserves input order, so the resulting `outcomes[i]` aligns
  // positionally with `targets[i]`.
  const batchStartedAt = Date.now()
  const settled = await Promise.allSettled(
    targets.map((target) =>
      limit(() =>
        // Deliberately do NOT catch here. `stepIndexEditionLocale`
        // already returns a typed `failed` outcome for every error it
        // can see; an unexpected throw past that boundary should
        // propagate as a `rejected` settled result so the synthetic-
        // failed branch below records it (with real elapsed time) and
        // the per-target isolation contract is observable to tests.
        _internals.stepIndexEditionLocale(target).then((o) => {
          logOutcome(o)
          return o
        }),
      ),
    ),
  )

  const outcomes: BackfillOutcome[] = settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value
    const target = targets[i]!
    const synthetic: BackfillOutcome = {
      status: "failed",
      target,
      locale: target.locale,
      reason:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      durationMs: Date.now() - batchStartedAt,
    }
    logOutcome(synthetic)
    return synthetic
  })

  return stepReport({
    mappingGeneratedAt: mapping.generatedAt,
    targets: targets.length,
    localeFilter:
      input.locales && input.locales.length > 0 ? input.locales : null,
    outcomes,
  })
}

async function stepLoadMapping(s3Key: string): Promise<CoreIdMapping> {
  "use step"
  return loadCoreIdMapping(s3Key)
}

async function stepEnumerateTargets(
  coreIdFilter: readonly string[] | undefined,
  mapping: CoreIdMapping,
): Promise<BackfillTarget[]> {
  "use step"

  const filter = coreIdFilter ? new Set(coreIdFilter) : null

  // One row per `(video, edition, bcp47)` triple, where the locale is
  // drawn from the union of three content sources the video actually
  // uses:
  //   1. `video.primary_language_id` — the authored source language
  //   2. `video_subtitle.language_id` — languages with subtitle tracks
  //      on this specific edition
  //   3. `video_dub.language_id` — languages with audio dubs on this
  //      edition
  // This is "every locale that exists for this video" — the default is
  // data-derived, not a hardcoded set. Soft-delete is enforced on
  // every leg so a deleted edition doesn't surface through a surviving
  // dub/subtitle. `Language.bcp47` has no @map in admin's schema, so
  // the DB column name matches the field name; NULL bcp47 values are
  // excluded because they're unindexable.
  //
  // Historical note: earlier prototype iterations hardcoded
  // `DEFAULT_LOCALES = ["en", "es", "fr"]`. Dropped when the R2
  // transcript backfill surfaced the pattern as a class of bug — see
  // docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md.
  const rows = await prisma.$queryRaw<
    Array<{
      video_id: string
      video_edition_id: string
      core_id: string
      bcp47: string
    }>
  >`
    WITH edition_locales AS (
      SELECT DISTINCT
        v.id AS video_id,
        e.id AS video_edition_id,
        v.core_id AS core_id,
        l.bcp47 AS bcp47
      FROM video v
      JOIN video_dub d ON d.video_id = v.id AND d.deleted_at IS NULL
      JOIN video_edition e ON e.id = d.video_edition_id AND e.deleted_at IS NULL
      JOIN language l ON l.id = v.primary_language_id
      WHERE v.deleted_at IS NULL
        AND l.bcp47 IS NOT NULL

      UNION

      SELECT DISTINCT
        v.id,
        e.id,
        v.core_id,
        l.bcp47
      FROM video v
      JOIN video_dub d ON d.video_id = v.id AND d.deleted_at IS NULL
      JOIN video_edition e ON e.id = d.video_edition_id AND e.deleted_at IS NULL
      JOIN video_subtitle s ON s.video_edition_id = e.id AND s.deleted_at IS NULL
      JOIN language l ON l.id = s.language_id
      WHERE v.deleted_at IS NULL
        AND l.bcp47 IS NOT NULL

      UNION

      SELECT DISTINCT
        v.id,
        e.id,
        v.core_id,
        l.bcp47
      FROM video v
      JOIN video_dub d ON d.video_id = v.id AND d.deleted_at IS NULL
      JOIN video_edition e ON e.id = d.video_edition_id AND e.deleted_at IS NULL
      JOIN language l ON l.id = d.language_id
      WHERE v.deleted_at IS NULL
        AND l.bcp47 IS NOT NULL
    )
    SELECT video_id, video_edition_id, core_id, bcp47
    FROM edition_locales
    ORDER BY core_id, bcp47
  `

  const targets: BackfillTarget[] = []
  for (const row of rows) {
    if (filter && !filter.has(row.core_id)) continue
    const cmsVideoId = mapping.byCoreId.get(row.core_id)
    if (cmsVideoId === undefined) continue
    targets.push({
      videoId: row.video_id,
      videoEditionId: row.video_edition_id,
      coreId: row.core_id,
      cmsVideoId,
      locale: row.bcp47,
    })
  }

  return targets
}

async function stepIndexEditionLocale(
  target: BackfillTarget,
): Promise<BackfillOutcome> {
  "use step"

  const startedAt = Date.now()

  try {
    const result = await indexEditionScenes(prisma, {
      editionId: target.videoEditionId,
      videoId: target.videoId,
      coreId: target.coreId,
      locale: target.locale,
      cmsVideoId: target.cmsVideoId,
      user: SYSTEM_PRINCIPAL,
    })
    return toSucceeded(target, target.locale, result, Date.now() - startedAt)
  } catch (error) {
    const durationMs = Date.now() - startedAt
    // Branch on the typed error class, not error-message regex. Only a
    // genuinely-missing artifact gets demoted to skipped; every other
    // error shape (including ManagerArtifactError artifact_invalid,
    // artifact_read_failed, and Prisma P2025 "Record not found") stays
    // classified as failed so the operator sees it in the report.
    if (
      error instanceof ManagerArtifactError &&
      error.code === "artifact_missing"
    ) {
      return {
        status: "skipped",
        target,
        locale: target.locale,
        reason: "artifact_missing",
        durationMs,
      }
    }
    const reason = error instanceof Error ? error.message : String(error)
    return {
      status: "failed",
      target,
      locale: target.locale,
      reason,
      durationMs,
    }
  }
}

function stepReport(args: {
  mappingGeneratedAt: string
  targets: number
  localeFilter: readonly string[] | null
  outcomes: BackfillOutcome[]
}): SceneEmbeddingBackfillReport {
  let succeeded = 0
  let skipped = 0
  let failed = 0
  for (const outcome of args.outcomes) {
    switch (outcome.status) {
      case "succeeded":
        succeeded += 1
        break
      case "skipped":
        skipped += 1
        break
      case "failed":
        failed += 1
        break
      default: {
        // Exhaustive check: if BackfillOutcome gains a new variant the
        // compiler will surface this line until the new case is handled.
        const _exhaustive: never = outcome
        throw new Error(
          `Unhandled BackfillOutcome variant: ${JSON.stringify(_exhaustive)}`,
        )
      }
    }
  }

  return {
    mappingGeneratedAt: args.mappingGeneratedAt,
    totalTargets: args.targets,
    localeFilter: args.localeFilter,
    outcomes: args.outcomes,
    succeeded,
    skipped,
    failed,
  }
}

function toSucceeded(
  target: BackfillTarget,
  locale: string,
  result: IndexEditionScenesResult,
  durationMs: number,
): BackfillOutcome {
  return {
    status: "succeeded",
    target,
    locale,
    scenesIndexed: result.scenesIndexed,
    embeddingsWritten: result.embeddingsWritten,
    durationMs,
  }
}

function logOutcome(outcome: BackfillOutcome): void {
  // logOutcome runs OUTSIDE the per-target try/catch in the for-of
  // loop, so a JSON.stringify throw (circular structure, BigInt,
  // unstringifiable error in outcome.reason) would halt the run and
  // leave remaining targets unprocessed. Same defensive wrap R3
  // adopted; the per-target isolation contract demands log failures
  // never escape.
  try {
    switch (outcome.status) {
      case "succeeded":
        console.log(
          JSON.stringify({
            workflow: "scene-embedding-backfill",
            event: "scene_index_complete",
            coreId: outcome.target.coreId,
            videoEditionId: outcome.target.videoEditionId,
            locale: outcome.locale,
            scenesIndexed: outcome.scenesIndexed,
            embeddingsWritten: outcome.embeddingsWritten,
            durationMs: outcome.durationMs,
          }),
        )
        return
      case "skipped":
        console.log(
          JSON.stringify({
            workflow: "scene-embedding-backfill",
            event: "scene_index_skipped",
            coreId: outcome.target.coreId,
            videoEditionId: outcome.target.videoEditionId,
            locale: outcome.locale,
            reason: outcome.reason,
            durationMs: outcome.durationMs,
          }),
        )
        return
      case "failed":
        console.error(
          JSON.stringify({
            workflow: "scene-embedding-backfill",
            event: "scene_index_failed",
            coreId: outcome.target.coreId,
            videoEditionId: outcome.target.videoEditionId,
            locale: outcome.locale,
            reason: outcome.reason,
            durationMs: outcome.durationMs,
          }),
        )
        return
      default: {
        const _exhaustive: never = outcome
        throw new Error(
          `Unhandled BackfillOutcome variant: ${JSON.stringify(_exhaustive)}`,
        )
      }
    }
  } catch (logErr) {
    console.error(
      `[scene-embedding-backfill] logOutcome failed: ${
        logErr instanceof Error ? logErr.message : String(logErr)
      }`,
    )
  }
}

// Exported for tests — these are the pure functions inside the steps,
// safe to exercise without the useworkflow runtime. `stepEnumerateTargets`
// is wrapped in a thin helper that accepts a prisma instance so tests
// can use a stub; the workflow step uses the module singleton.
//
// `stepIndexEditionLocale` is referenced through `_internals` from the
// workflow body so tests can `vi.spyOn(_internals, "stepIndexEditionLocale")`
// to force a `Promise.allSettled` rejection — the only way to exercise
// the synthetic-failed defensive branch, since the real step body
// catches everything internally.
export const _internals = {
  stepReport,
  stepIndexEditionLocale,
  toSucceeded,
  logOutcome,
}
