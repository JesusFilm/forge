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
import type { SceneAnalysisResult } from "@/services/manager-artifacts.service"
import {
  indexEditionScenes,
  type IndexEditionScenesResult,
} from "@/services/scene-embedding.service"
// The artifact-load step lives in a separate module on purpose — the
// useworkflow build plugin treats functions imported into a workflow
// file as workflow scope, so importing `readSceneAnalysisArtifact`
// here would trip the Node-module reachability check even though the
// actual call is inside `"use step"`. See `_steps/load-manager-artifact.ts`.
import { stepLoadSceneAnalysisArtifact } from "./_steps/load-manager-artifact"

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
  retryTargets?: readonly SceneEmbeddingRetryTarget[]
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

export type SceneEmbeddingRetryTarget = {
  coreId: string
  videoEditionId: string
  locale: string
}

export type RetrySelectionReport = {
  requested: number
  matched: number
  unmatched: number
  unmatchedRetryTargets: ReadonlyArray<SceneEmbeddingRetryTarget>
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
      failureCategory: SceneFailureCategory
      durationMs: number
    }

/**
 * One entry per upstream gap surfaced by this run. Derived at
 * report-assembly time from `skipped { reason: "artifact_missing" }`
 * outcomes — see `deriveMissingArtifacts`. The list is deduped by
 * `assetId` (R1's group-level cascade emits L outcomes per missing
 * `(video, edition)` for L locales — operators want the unique set
 * of upstream gaps, not L copies) and sorted ascending so an operator
 * piping the list into `pnpm trigger-enrichment --from-report=…`
 * (PR2 of feat-119) gets a deterministic ordering.
 *
 * **Naming**: `assetId` here IS the same number as `BackfillTarget.cmsVideoId`
 * (Strapi's PK on the cms videos table). It is renamed to `assetId` in this
 * type because manager-side artifact storage and PR2's enrichment trigger
 * universally call it `assetId` — keeping the name consistent with the
 * downstream consumer reduces friction.
 *
 * `kind` is a literal-union member identifying which manager-side
 * pipeline produces the missing artifact. The R1 workflow always
 * produces `"scene-analysis"`; R2 produces `"transcript"`. The PR2
 * trigger endpoint dispatches the right pipeline based on this field.
 *
 * Note: ONLY skipped-with-reason-artifact_missing outcomes feed this
 * list. A `failed` outcome is a real failure for the operator to
 * investigate, not an upstream gap to enrich. Conflating them was the
 * pre-feat-119 misclassification bug — see
 * docs/roadmap/content-discovery/feat-119-*.md and
 * docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md.
 */
export type MissingArtifact = {
  readonly assetId: number
  readonly coreId: string
  readonly kind: "scene-analysis"
}

export type SceneFailureCategory =
  | "artifact_read_failed"
  | "artifact_invalid"
  | "dns_failed"
  | "timeout"
  | "access_denied"
  | "bucket_not_found"
  | "prisma_transaction"
  | "provider_validation"
  | "other"

export type GroupedSceneFailure = {
  readonly assetId: number
  readonly coreId: string
  readonly videoEditionId: string
  readonly category: SceneFailureCategory
  readonly count: number
  readonly sampleReason: string
  readonly sampleLocales: readonly string[]
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
  /**
   * Deduped, sorted-ascending list of upstream gaps the operator can
   * feed into PR2's enrichment trigger. Length 0 when every target
   * had its scene-analysis artifact present. See `MissingArtifact`.
   */
  missingArtifacts: ReadonlyArray<MissingArtifact>
  retrySelection: RetrySelectionReport | null
  groupedFailures: ReadonlyArray<GroupedSceneFailure>
}

export class SceneRetrySelectionError extends Error {
  constructor(
    message: string,
    readonly retrySelection: RetrySelectionReport,
  ) {
    super(message)
    this.name = "SceneRetrySelectionError"
  }
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
  const broadTargets = localeFilter
    ? allTargets.filter((t) => localeFilter.has(t.locale))
    : allTargets
  const retrySelection = reconcileRetryTargets(broadTargets, input.retryTargets)
  if (retrySelection && retrySelection.unmatched > 0) {
    throw new SceneRetrySelectionError(
      `Scene retry selector mismatch: ${retrySelection.unmatched} of ${retrySelection.requested} requested retry targets no longer match current enumeration`,
      retrySelection,
    )
  }
  const targets = retrySelection
    ? applyRetrySelection(broadTargets, input.retryTargets ?? [])
    : broadTargets

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
        failureCategory: classifySceneFailure(result.reason),
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
    retrySelection,
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
  "use step"
  const groupStartedAt = Date.now()

  // useworkflow replay note: the S3 read goes through `stepLoadArtifact`
  // (a `"use step"` function below) so a worker restart mid-group
  // replays the journaled result instead of re-fetching. The build
  // plugin requires this — `s3.ts` imports Node-only modules
  // (`node:fs/promises`, `node:path`) for the local-fallback path, so
  // any direct call from the workflow scope is rejected at compile
  // time. Persisting ~250 KB JSON per group as a step result is the
  // necessary trade-off; it's small per-call but adds up across a full
  // backfill — operators monitoring useworkflow journal size should be
  // aware.

  let loadedArtifact: SceneAnalysisResult
  try {
    loadedArtifact = await stepLoadSceneAnalysisArtifact(group.cmsVideoId)
  } catch (error) {
    // Cascade the load failure to all locales in the group with the
    // right classification. A genuine "manager hasn't run scene
    // analysis yet" → skipped. Anything else → failed (including
    // ManagerArtifactError artifact_invalid / artifact_read_failed).
    const durationMs = Date.now() - groupStartedAt
    const isMissing = getManagerArtifactCode(error) === "artifact_missing"
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
            failureCategory: classifySceneFailure(error),
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
    // Branch on the stable error code, not error-message regex. Only a
    // genuinely-missing artifact gets demoted to skipped; every other
    // error shape (including artifact_invalid, artifact_read_failed,
    // EmbeddingsBatchError, and Prisma P2025 "Record not found") stays
    // classified as failed so the operator sees it in the report. With
    // Stage 2's group-level artifact load, an `artifact_missing` here
    // would only fire if the indexer's empty-`loadedArtifact`
    // short-circuit somehow bypassed the cache; keep the classification
    // path intact for safety in depth.
    if (getManagerArtifactCode(error) === "artifact_missing") {
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
      failureCategory: classifySceneFailure(error),
      durationMs,
    }
  }
}

function retryTargetKey(target: SceneEmbeddingRetryTarget): string {
  return `${target.coreId}::${target.videoEditionId}::${target.locale}`
}

function dedupeRetryTargets(
  retryTargets: readonly SceneEmbeddingRetryTarget[],
): SceneEmbeddingRetryTarget[] {
  const byKey = new Map<string, SceneEmbeddingRetryTarget>()
  for (const target of retryTargets) {
    const key = retryTargetKey(target)
    if (!byKey.has(key)) byKey.set(key, target)
  }
  return [...byKey.values()].sort((a, b) =>
    retryTargetKey(a).localeCompare(retryTargetKey(b)),
  )
}

function reconcileRetryTargets(
  targets: readonly BackfillTarget[],
  retryTargets: readonly SceneEmbeddingRetryTarget[] | undefined,
): RetrySelectionReport | null {
  if (retryTargets === undefined) return null
  const available = new Set(
    targets.map((target) =>
      retryTargetKey({
        coreId: target.coreId,
        videoEditionId: target.videoEditionId,
        locale: target.locale,
      }),
    ),
  )
  const deduped = dedupeRetryTargets(retryTargets)
  const unmatchedRetryTargets = deduped.filter(
    (target) => !available.has(retryTargetKey(target)),
  )
  return {
    requested: deduped.length,
    matched: deduped.length - unmatchedRetryTargets.length,
    unmatched: unmatchedRetryTargets.length,
    unmatchedRetryTargets,
  }
}

function applyRetrySelection(
  targets: readonly BackfillTarget[],
  retryTargets: readonly SceneEmbeddingRetryTarget[],
): BackfillTarget[] {
  const requested = new Set(
    dedupeRetryTargets(retryTargets).map(retryTargetKey),
  )
  return targets.filter((target) =>
    requested.has(
      retryTargetKey({
        coreId: target.coreId,
        videoEditionId: target.videoEditionId,
        locale: target.locale,
      }),
    ),
  )
}

/**
 * Project the outcome list to the deduped, sorted set of missing
 * scene-analysis artifacts. Pure function — no DB access, no side
 * effects, deterministic per input. Cascade dedup by assetId is the
 * key invariant: R1's per-locale fan-out emits L outcomes per missing
 * `(video, edition)` group, and the operator wants ONE entry per
 * missing asset (not L copies that all point at the same upstream
 * gap). Filters `failed` outcomes out — a real failure is a
 * different operator action than an upstream gap.
 *
 * **Tiebreak**: when multiple outcomes share the same `assetId`, the
 * FIRST one encountered wins (`Map.has` short-circuit). In production
 * this is invisible because all outcomes for one assetId share the
 * same `coreId` (assetId === cmsVideoId, coreId is mapping-derived
 * 1:1). The tiebreak only matters if a future refactor introduces two
 * distinct coreIds for the same cmsVideoId — at which point the
 * first-seen wins. Stable across runs because `outcomes` is built in
 * a deterministic enumeration order from `stepEnumerateTargets`.
 */
function deriveMissingArtifacts(
  outcomes: readonly BackfillOutcome[],
): MissingArtifact[] {
  const byAssetId = new Map<number, MissingArtifact>()
  for (const outcome of outcomes) {
    if (outcome.status !== "skipped") continue
    if (outcome.reason !== "artifact_missing") continue
    if (byAssetId.has(outcome.target.cmsVideoId)) continue
    byAssetId.set(outcome.target.cmsVideoId, {
      assetId: outcome.target.cmsVideoId,
      coreId: outcome.target.coreId,
      kind: "scene-analysis",
    })
  }
  return Array.from(byAssetId.values()).sort((a, b) => a.assetId - b.assetId)
}

function deriveGroupedFailures(
  outcomes: readonly BackfillOutcome[],
): GroupedSceneFailure[] {
  const byKey = new Map<
    string,
    { failure: GroupedSceneFailure; locales: Set<string> }
  >()
  for (const outcome of outcomes) {
    if (outcome.status !== "failed") continue
    const key = `${outcome.target.cmsVideoId}::${outcome.target.videoEditionId}::${outcome.failureCategory}`
    let entry = byKey.get(key)
    if (!entry) {
      entry = {
        failure: {
          assetId: outcome.target.cmsVideoId,
          coreId: outcome.target.coreId,
          videoEditionId: outcome.target.videoEditionId,
          category: outcome.failureCategory,
          count: 0,
          sampleReason: outcome.reason,
          sampleLocales: [],
        },
        locales: new Set<string>(),
      }
      byKey.set(key, entry)
    }
    entry.failure = { ...entry.failure, count: entry.failure.count + 1 }
    if (entry.locales.size < 5) entry.locales.add(outcome.locale)
  }

  return [...byKey.values()]
    .map(({ failure, locales }) => ({
      ...failure,
      sampleLocales: [...locales].sort(),
    }))
    .sort(
      (a, b) =>
        a.assetId - b.assetId ||
        a.videoEditionId.localeCompare(b.videoEditionId) ||
        a.category.localeCompare(b.category),
    )
}

function classifySceneFailure(error: unknown): SceneFailureCategory {
  const artifactCode = getManagerArtifactCode(error)
  if (artifactCode === "artifact_invalid") return "artifact_invalid"
  if (artifactCode === "artifact_read_failed") {
    return classifySceneFailure(
      getUnknownProp(error, "cause") ??
        (error instanceof Error ? error.message : String(error)),
    )
  }
  const name = getStringProp(error, "name")
  const code = getStringProp(error, "code") ?? getStringProp(error, "Code")
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    lower.includes("getaddrinfo enotfound")
  ) {
    return "dns_failed"
  }
  if (
    name === "TimeoutError" ||
    name === "AbortError" ||
    code === "ETIMEDOUT" ||
    lower.includes("timeout") ||
    lower.includes("timed out")
  ) {
    return "timeout"
  }
  if (
    name === "AccessDenied" ||
    code === "AccessDenied" ||
    lower.includes("accessdenied") ||
    lower.includes("access denied")
  ) {
    return "access_denied"
  }
  if (
    name === "NoSuchBucket" ||
    code === "NoSuchBucket" ||
    lower.includes("nosuchbucket")
  ) {
    return "bucket_not_found"
  }
  if (lower.includes("artifact_read_failed")) return "artifact_read_failed"
  if (lower.includes("artifact_invalid")) return "artifact_invalid"
  if (lower.includes("p1017") || lower.includes("p2028")) {
    return "prisma_transaction"
  }
  if (
    lower.includes("embedding response validation failed") ||
    lower.includes("provider validation")
  ) {
    return "provider_validation"
  }
  return "other"
}

function getManagerArtifactCode(
  error: unknown,
):
  | "artifact_missing"
  | "artifact_invalid"
  | "artifact_read_failed"
  | undefined {
  const code = getStringProp(error, "code")
  if (code === "artifact_missing") return code
  if (code === "artifact_invalid") return code
  if (code === "artifact_read_failed") return code
  return undefined
}

function getStringProp(error: unknown, prop: string): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const value = (error as Record<string, unknown>)[prop]
  return typeof value === "string" ? value : undefined
}

function getUnknownProp(error: unknown, prop: string): unknown {
  if (typeof error !== "object" || error === null) return undefined
  return (error as Record<string, unknown>)[prop]
}

function stepReport(args: {
  mappingGeneratedAt: string
  targets: number
  localeFilter: readonly string[] | null
  retrySelection: RetrySelectionReport | null
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
    missingArtifacts: deriveMissingArtifacts(args.outcomes),
    retrySelection: args.retrySelection,
    groupedFailures: deriveGroupedFailures(args.outcomes),
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
  reconcileRetryTargets,
  applyRetrySelection,
  classifySceneFailure,
  deriveGroupedFailures,
}
