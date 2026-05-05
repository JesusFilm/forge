// Scene embedding backfill — durable useworkflow job that indexes
// manager's scene-analysis artifacts into admin's Postgres.
//
// Flow (Stage 2 — feat-116):
//   1. stepLoadMapping        — load coreId → cms video id snapshot
//   2. stepEnumerateTargets   — list (video, edition, locale) triples
//                               where the locale is data-derived from
//                               the union of each video's primary
//                               language + edition-level subtitle
//                               languages + edition-level dub languages
//   3. groupTargetsByVideoEdition — flat targets → groups keyed by
//                               (videoId, videoEditionId). The artifact
//                               is shared across every locale in a
//                               group, so fetching it once per group
//                               collapses S3 reads from N×L to N.
//   4. processGroup           — per-group worker:
//        4a. Load scene-analysis artifact ONCE for the group.
//        4b. For each locale in the group, call stepIndexEditionLocale
//            with `loadedArtifact` so the service skips the S3 read
//            and runs ONE batched provider call per locale.
//   5. stepReport             — aggregate per-target outcomes.
//
// Per-target errors are caught inside the per-locale step so one bad
// artifact / provider response doesn't halt the whole backfill. A
// group-level artifact-load failure cascades to per-locale outcomes
// for every locale in that group with the right classification
// (artifact_missing → skipped; everything else → failed). The indexer
// itself remains idempotent (upserts on composite keys), so the
// workflow is safe to re-run.
//
// pLimit boundary moved up one level relative to Stage 1: the cap now
// constrains concurrent (video, edition) GROUPS, not concurrent flat
// targets. Inside a group, per-locale work runs sequentially so the
// loaded artifact stays scoped to one stack frame.
//
// Locale model: data-derived at enumeration time ("every locale that
// exists for this video"), not a hardcoded list. An earlier prototype
// used `DEFAULT_LOCALES = ["en", "es", "fr"]`; dropped per
// docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md.
// The caller's `locales` filter narrows which BCP-47 tags are processed
// (omitted means all data-derived locales). Filtering happens BEFORE
// grouping so a group only spans the locales that survive the filter.

import pLimit from "p-limit"
import { prisma } from "@/db/client"
import { SYSTEM_PRINCIPAL } from "@/auth/principal"
import { env } from "@/config/env"
import {
  loadCoreIdMapping,
  type CoreIdMapping,
} from "@/services/core-id-mapping.service"
import {
  ManagerArtifactError,
  readSceneAnalysisArtifact,
  type SceneAnalysisResult,
} from "@/services/manager-artifacts.service"
import {
  indexEditionScenes,
  type IndexEditionScenesResult,
} from "@/services/scene-embedding.service"

/**
 * Default per-group concurrency for the R1 scene-embedding backfill.
 * Stage 2: the unit changed from per-target to per-(video, edition)
 * GROUP. A group typically holds several locales which run sequentially
 * inside the worker, so 5 concurrent groups can produce >5 concurrent
 * indexer/provider calls only if each group's per-locale loop overlaps
 * — which it doesn't (sequential per-locale). Net concurrent indexer
 * load stays ≤ N (one per active group). Override via
 * `SCENE_EMBEDDING_CONCURRENCY` (env-validated, positive int). Sized
 * below admin's documented `connection_limit=10` Prisma pool to leave
 * headroom for concurrent GraphQL/REST traffic; local dev can crank to
 * 20+ via the env override.
 *
 * Memory budget per active locale: ~250 KB artifact + ~370 KB
 * embeddings array (1536 floats × ~30 scenes × 8 bytes) + ~10 KB
 * sourceTexts ≈ ~630 KB. At default concurrency=5 that's ~3 MB peak
 * resident across in-flight groups; released as soon as the
 * per-locale transaction completes.
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

/**
 * One group per (videoId, videoEditionId). Stage 2 groups flat targets
 * along this axis so the manager-artifacts S3 read happens once and the
 * loaded artifact is reused across every locale in the group.
 *
 * `targets` order is preserved from enumeration; the indexer fans out
 * sequentially across that order inside the group worker.
 */
export type BackfillGroup = Omit<BackfillTarget, "locale"> & {
  targets: readonly BackfillTarget[]
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

  // Group flat targets by (video, edition) so the artifact load
  // collapses from per-target to per-group.
  const groups = groupTargetsByVideoEdition(targets)

  // Bounded parallelism over GROUPS (Stage 2 reshape). `pLimit(N) +
  // Promise.allSettled` is the documented robustness shape — never
  // bare `Promise.all`. See
  // docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md
  // and the canonical HOW in
  // docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md.
  // Stage 2's only divergence: the unit-of-parallelism is a (video,
  // edition) group rather than a flat (video, edition, locale) target;
  // per-locale work inside a group runs sequentially with the artifact
  // in scope.
  const concurrency =
    env.SCENE_EMBEDDING_CONCURRENCY ?? DEFAULT_SCENE_EMBEDDING_CONCURRENCY
  const limit = pLimit(concurrency)

  // Emit a structured start log so the workflow's effective
  // concurrency is observable from any trigger path (GraphQL mutation
  // or local CLI). `groupCount` surfaces Stage 2's reshape so an
  // operator inspecting logs can see the artifact-fetch fan-in.
  console.log(
    JSON.stringify({
      workflow: "scene-embedding-backfill",
      event: "start",
      mappingGeneratedAt: mapping.generatedAt,
      totalTargets: targets.length,
      groupCount: groups.length,
      concurrency,
      localeFilter:
        input.locales && input.locales.length > 0 ? input.locales : null,
    }),
  )

  // One batch wall-clock baseline; reused for synthetic-failed
  // outcomes so dashboards built on `outcomes[].durationMs` aren't
  // polluted with `0`s when the defensive branch fires.
  const batchStartedAt = Date.now()

  const settled = await Promise.allSettled(
    groups.map((group) =>
      limit(() =>
        // Deliberately do NOT catch here. `processGroup` already
        // returns typed outcomes for every per-target error it can see
        // (including a group-level artifact-load failure cascaded to
        // per-locale outcomes); an unexpected throw past that boundary
        // should propagate as a `rejected` settled result so the
        // synthetic-failed branch below records it (with real elapsed
        // time) and the per-target isolation contract is observable to
        // tests.
        processGroup(group),
      ),
    ),
  )

  const outcomes: BackfillOutcome[] = settled.flatMap((result, i) => {
    const group = groups[i]!
    if (result.status === "fulfilled") return result.value
    // Synthetic-failed cascade for the WHOLE group — a thrown error
    // past `processGroup`'s defensive branch is a step-plumbing fault
    // and should not aggregate as "one of the locales failed"; every
    // locale in the affected group lost its work.
    const reason =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason)
    const durationMs = Date.now() - batchStartedAt
    return group.targets.map((target) => {
      const synthetic: BackfillOutcome = {
        status: "failed",
        target,
        locale: target.locale,
        reason,
        durationMs,
      }
      logOutcome(synthetic)
      return synthetic
    })
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

/**
 * Group flat (video, edition, locale) targets by (videoId,
 * videoEditionId). Preserves first-seen order so a per-test or per-
 * operator-reasoning ordering doesn't shift unexpectedly. Each group's
 * `targets` keep their original enumeration order.
 *
 * Pure data transform — no Prisma access. Easy to unit-test in
 * isolation and replay-safe inside `"use workflow"`.
 */
function groupTargetsByVideoEdition(
  targets: readonly BackfillTarget[],
): BackfillGroup[] {
  // Map preserves insertion order, which matches the enumeration's
  // `ORDER BY core_id, bcp47` so consumer logs stay deterministic.
  const groupMap = new Map<
    string,
    { group: BackfillGroup; targets: BackfillTarget[] }
  >()
  for (const target of targets) {
    const key = `${target.videoId}::${target.videoEditionId}`
    let entry = groupMap.get(key)
    if (entry === undefined) {
      const targetsArr: BackfillTarget[] = []
      // `satisfies BackfillGroup` makes a future field added to
      // BackfillTarget surface as a compile error here: BackfillGroup
      // is `Omit<BackfillTarget, "locale">`, so if BackfillTarget
      // gains a `cmsLanguageId` (or anything else), this literal
      // becomes incomplete and TS flags it. First-seen `cmsVideoId`
      // wins if upstream data ever produces two targets for the same
      // (videoId, videoEditionId) with diverging cmsVideoIds.
      const group = {
        videoId: target.videoId,
        videoEditionId: target.videoEditionId,
        coreId: target.coreId,
        cmsVideoId: target.cmsVideoId,
        targets: targetsArr,
      } satisfies BackfillGroup
      entry = { group, targets: targetsArr }
      groupMap.set(key, entry)
    }
    entry.targets.push(target)
  }
  return Array.from(groupMap.values(), (e) => e.group)
}

/**
 * Per-group worker. Loads the scene-analysis artifact ONCE, then fans
 * out per-locale sequentially with the artifact in scope.
 *
 * Group-level artifact-load failure is cascaded to per-locale outcomes
 * with the same classification the per-locale path would have produced
 * (`artifact_missing` → skipped, anything else → failed). This
 * preserves Stage 1's per-locale outcome shape so the report's
 * succeeded/skipped/failed triple stays meaningful even when the load
 * fault is shared.
 */
async function processGroup(group: BackfillGroup): Promise<BackfillOutcome[]> {
  const groupStartedAt = Date.now()

  // useworkflow replay note: this S3 read is NOT inside a `"use step"`
  // boundary, so a worker restart mid-group re-fetches the artifact on
  // resume. Trade-off was deliberate per the parent plan's residual-
  // risks section — wrapping it in a step would persist the ~250 KB
  // artifact JSON to durable storage on every group, which is
  // disproportionate for an idempotent S3 GET. The per-locale step
  // boundary downstream is what carries replay durability.

  let loadedArtifact: SceneAnalysisResult
  try {
    loadedArtifact = await readSceneAnalysisArtifact(String(group.cmsVideoId))
  } catch (error) {
    // Cascade the load failure to all locales in the group with the
    // right classification. A genuine "manager hasn't run scene
    // analysis yet" → skipped. Anything else → failed (including
    // ManagerArtifactError artifact_invalid / artifact_read_failed).
    const durationMs = Date.now() - groupStartedAt
    const isMissing =
      error instanceof ManagerArtifactError && error.code === "artifact_missing"
    const reason = isMissing
      ? "artifact_missing"
      : error instanceof Error
        ? error.message
        : String(error)
    return group.targets.map((target) => {
      const outcome: BackfillOutcome = isMissing
        ? {
            status: "skipped",
            target,
            locale: target.locale,
            reason,
            durationMs,
          }
        : {
            status: "failed",
            target,
            locale: target.locale,
            reason,
            durationMs,
          }
      logOutcome(outcome)
      return outcome
    })
  }

  // Per-locale fan-out with the loaded artifact in scope. Sequential
  // inside the group so the artifact stays bounded to one stack frame
  // and the per-target step's timing measurement is honest.
  const outcomes: BackfillOutcome[] = []
  for (const target of group.targets) {
    const outcome = await _internals.stepIndexEditionLocale(
      target,
      loadedArtifact,
    )
    logOutcome(outcome)
    outcomes.push(outcome)
  }
  return outcomes
}

async function stepIndexEditionLocale(
  target: BackfillTarget,
  loadedArtifact: SceneAnalysisResult,
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
      loadedArtifact,
      user: SYSTEM_PRINCIPAL,
    })
    return toSucceeded(target, target.locale, result, Date.now() - startedAt)
  } catch (error) {
    const durationMs = Date.now() - startedAt
    // Branch on the typed error class, not error-message regex. Only a
    // genuinely-missing artifact gets demoted to skipped; every other
    // error shape (including ManagerArtifactError artifact_invalid,
    // artifact_read_failed, EmbeddingsBatchError, and Prisma P2025
    // "Record not found") stays classified as failed so the operator
    // sees it in the report. With Stage 2's group-level artifact load,
    // an `artifact_missing` here would only fire if the indexer's
    // empty-`loadedArtifact` short-circuit somehow bypassed the cache;
    // keep the classification path intact for safety in depth.
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
  // logOutcome runs OUTSIDE the per-target try/catch in `processGroup`
  // and OUTSIDE the synthetic-failed branch's mapping, so a
  // JSON.stringify throw (circular structure, BigInt, unstringifiable
  // error in outcome.reason) would halt the run and leave remaining
  // outcomes unprocessed. Same defensive wrap R3 adopted; the
  // per-target isolation contract demands log failures never escape.
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
// safe to exercise without the useworkflow runtime.
//
// `stepIndexEditionLocale` is referenced through `_internals` from
// `processGroup` so tests can `vi.spyOn(_internals,
// "stepIndexEditionLocale")` to force a `Promise.allSettled` rejection
// — the only way to exercise the synthetic-failed defensive branch,
// since the real step body catches everything internally.
export const _internals = {
  stepReport,
  stepIndexEditionLocale,
  toSucceeded,
  logOutcome,
  groupTargetsByVideoEdition,
}
