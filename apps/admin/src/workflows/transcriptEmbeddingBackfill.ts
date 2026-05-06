// Transcript embedding backfill — durable useworkflow job that
// indexes manager's embeddings.json artifacts into admin's Postgres.
//
// Flow (Stage 2 — feat-116):
//   1. stepLoadMapping              — load coreId → cms video id snapshot
//   2. stepEnumerateTargets         — list (video, edition, language)
//                                     triples; languages are derived
//                                     from the union of each video's
//                                     primary language + edition's
//                                     subtitle languages + edition's
//                                     dub languages
//   3. groupTargetsByVideoEdition   — flat targets → groups keyed by
//                                     (videoId, videoEditionId). The
//                                     embeddings artifact is shared
//                                     across every language in a group,
//                                     so fetching it once per group
//                                     collapses S3 reads from N×L to N.
//   4. processGroup                 — per-group worker:
//        4a. Load embeddings artifact ONCE for the group.
//        4b. For each language in the group, call
//            stepIndexEditionTranscript with `loadedArtifact` so the
//            service skips the S3 read.
//   5. stepReport                   — aggregate per-target outcomes.
//
// R2 divergence from R1: NO provider call (vector reuse from
// manager's `embeddings.json`). Stage 2 only adds the S3 cache for R2.
// See docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md.
//
// Per-target errors are caught inside the per-language step so one bad
// artifact doesn't halt the backfill. A group-level artifact-load
// failure cascades to per-language outcomes for every language in the
// group with the right classification (artifact_missing → skipped;
// everything else → failed). The indexer itself remains idempotent
// (upserts on (editionId, language) for the transcript and on
// (transcriptId, chunkIndex) for chunks), so the workflow is safe to
// re-run.
//
// pLimit boundary moved up one level relative to Stage 1: the cap now
// constrains concurrent (video, edition) GROUPS, not concurrent flat
// targets. Inside a group, per-language work runs sequentially so the
// loaded artifact stays scoped to one stack frame.
//
// Language model: data-derived at enumeration time, not a hardcoded
// list. Earlier prototype iterations hardcoded a `DEFAULT_LOCALES =
// ['en', 'es', 'fr']` constant + an `en` fallback; both dropped once
// the enumeration became data-derived.

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
  type EmbeddingsResult,
} from "@/services/manager-artifacts.service"
import {
  indexEditionTranscript,
  type IndexEditionTranscriptResult,
} from "@/services/transcript-embedding.service"
// The artifact-load step lives in a separate module on purpose — the
// useworkflow build plugin treats functions imported into a workflow
// file as workflow scope, so importing `readEmbeddingsArtifact` here
// would trip the Node-module reachability check even though the actual
// call is inside `"use step"`. See `_steps/load-manager-artifact.ts`.
import { stepLoadEmbeddingsArtifact } from "./_steps/load-manager-artifact"

/**
 * Default per-group concurrency for the R2 transcript-embedding
 * backfill. Stage 2: the unit changed from per-target to per-(video,
 * edition) GROUP. R2 is DB-bound (no provider call); the default is
 * sized below admin's documented `connection_limit=10` Prisma pool to
 * leave headroom for concurrent traffic. Local dev can crank to 20+
 * via the env override.
 *
 * Memory budget per active language: ~250 KB artifact (vectors are
 * reused in-place from the artifact's `chunks[i].embedding`; R2
 * doesn't allocate a parallel embeddings array). At default
 * concurrency=5 that's ~1.25 MB peak resident; released as soon as
 * the per-language transaction completes.
 */
export const DEFAULT_TRANSCRIPT_EMBEDDING_CONCURRENCY = 5

export type TranscriptEmbeddingBackfillInput = {
  /** S3 key of the JSON mapping snapshot uploaded via the admin refresh CLI. */
  mappingS3Key: string
  /** Restrict to these coreIds. Omitted = all mapped videos. */
  coreIds?: readonly string[]
  /**
   * Restrict to these BCP-47 languages. Omitted = every language that
   * appears across the corpus (union of primary language, subtitle
   * languages, and dub languages per edition). See `stepEnumerateTargets`
   * for the derivation.
   */
  languages?: readonly string[]
}

export type BackfillTarget = {
  videoId: string
  videoEditionId: string
  coreId: string
  cmsVideoId: number
  /**
   * BCP-47 language to be stamped on the `VideoTranscript` row.
   * Derived per enumeration: one target per `(videoEdition, language)`
   * pair where language appears in any of the video's primary
   * language, the edition's subtitle languages, or the edition's dub
   * languages. No hardcoded fallback — if no source language exists
   * for an edition, the edition simply produces no targets.
   */
  language: string
}

/**
 * One group per (videoId, videoEditionId). Stage 2 groups flat targets
 * along this axis so the manager-artifacts S3 read happens once and
 * the loaded embeddings artifact is reused across every language in
 * the group.
 *
 * `targets` order is preserved from enumeration; the indexer fans out
 * sequentially across that order inside the group worker.
 */
export type BackfillGroup = Omit<BackfillTarget, "language"> & {
  targets: readonly BackfillTarget[]
}

export type BackfillOutcome =
  | {
      status: "succeeded"
      target: BackfillTarget
      language: string
      chunksIndexed: number
      embeddingsWritten: number
      chunksPruned: number
      durationMs: number
    }
  | {
      status: "skipped"
      target: BackfillTarget
      language: string
      reason: string
      durationMs: number
    }
  | {
      status: "failed"
      target: BackfillTarget
      language: string
      reason: string
      durationMs: number
    }

/**
 * One entry per upstream gap surfaced by this run. Mirrors the R1
 * (scene-embedding) shape — see that file for the dedup-by-assetId +
 * sort-ascending rationale. The R2 workflow stamps every entry with
 * `kind: "transcript"` so PR2's trigger endpoint dispatches the
 * transcript pipeline (vs scene-analysis). Only
 * `skipped { reason: "artifact_missing" }` outcomes feed this list;
 * `failed` outcomes are real failures, not upstream gaps.
 *
 * **Naming**: `assetId` here IS the same number as `BackfillTarget.cmsVideoId`
 * (Strapi's PK on the cms videos table). It is renamed to `assetId`
 * because manager-side artifact storage and PR2's enrichment trigger
 * universally use that name. Keeping it consistent with the downstream
 * consumer reduces friction.
 */
export type MissingArtifact = {
  readonly assetId: number
  readonly coreId: string
  readonly kind: "transcript"
}

export type TranscriptEmbeddingBackfillReport = {
  mappingGeneratedAt: string
  totalTargets: number
  languageFilter: readonly string[] | null
  outcomes: BackfillOutcome[]
  succeeded: number
  skipped: number
  failed: number
  /**
   * Deduped, sorted-ascending list of upstream gaps the operator can
   * feed into PR2's enrichment trigger. Length 0 when every target
   * had its embeddings artifact present. See `MissingArtifact`.
   */
  missingArtifacts: ReadonlyArray<MissingArtifact>
}

export async function runTranscriptEmbeddingBackfill(
  input: TranscriptEmbeddingBackfillInput,
): Promise<TranscriptEmbeddingBackfillReport> {
  "use workflow"

  const mapping = await stepLoadMapping(input.mappingS3Key)
  // Treat length-0 arrays as "omitted" so a GraphQL caller who
  // accidentally passes `coreIds: []` / `languages: []` doesn't
  // silently run zero work with a success-shaped report. Matches the
  // mutation description's "Omitted = all mapped videos" / "Omitted =
  // all data-derived languages" contract.
  const coreIdsFilter =
    input.coreIds && input.coreIds.length > 0 ? input.coreIds : undefined
  const languageFilter =
    input.languages && input.languages.length > 0
      ? new Set(input.languages)
      : null

  const allTargets = await stepEnumerateTargets(coreIdsFilter, mapping)
  const targets = languageFilter
    ? allTargets.filter((t) => languageFilter.has(t.language))
    : allTargets

  // Group flat targets by (video, edition) so the artifact load
  // collapses from per-target to per-group.
  const groups = groupTargetsByVideoEdition(targets)

  // Bounded parallelism over GROUPS (Stage 2 reshape). Same shape /
  // same rule as R1 — see the R1 sibling for the full rationale and
  // docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md
  // for the canonical HOW. R2's only divergence from R1 stays the same:
  // no provider call inside the per-language step.
  const concurrency =
    env.TRANSCRIPT_EMBEDDING_CONCURRENCY ??
    DEFAULT_TRANSCRIPT_EMBEDDING_CONCURRENCY
  const limit = pLimit(concurrency)

  // Structured start log so the workflow's effective concurrency is
  // observable from any trigger path. `groupCount` surfaces Stage 2's
  // reshape so an operator inspecting logs can see the artifact-fetch
  // fan-in.
  console.log(
    JSON.stringify({
      workflow: "transcript-embedding-backfill",
      event: "start",
      mappingGeneratedAt: mapping.generatedAt,
      totalTargets: targets.length,
      groupCount: groups.length,
      concurrency,
      languageFilter:
        input.languages && input.languages.length > 0 ? input.languages : null,
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
        // per-language outcomes); an unexpected throw past that
        // boundary should propagate as a `rejected` settled result so
        // the synthetic-failed branch below records it (with real
        // elapsed time) and the per-target isolation contract is
        // observable to tests.
        processGroup(group),
      ),
    ),
  )

  const outcomes: BackfillOutcome[] = settled.flatMap((result, i) => {
    const group = groups[i]!
    if (result.status === "fulfilled") return result.value
    // Synthetic-failed cascade for the WHOLE group — a thrown error
    // past `processGroup`'s defensive branch is a step-plumbing fault
    // and should not aggregate as "one of the languages failed";
    // every language in the affected group lost its work.
    const reason =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason)
    const durationMs = Date.now() - batchStartedAt
    return group.targets.map((target) => {
      const synthetic: BackfillOutcome = {
        status: "failed",
        target,
        language: target.language,
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
    languageFilter:
      input.languages && input.languages.length > 0 ? input.languages : null,
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

  // One row per `(video, edition, bcp47)` triple, where the language
  // is drawn from the union of three content sources the video
  // actually uses:
  //   1. `video.primary_language_id` — the authored source language
  //   2. `video_subtitle.language_id` — languages with subtitle tracks
  //      on this specific edition
  //   3. `video_dub.language_id` — languages with audio dubs on this
  //      edition
  // This is "every locale that exists for this video" per the user's
  // direction: the default is data-derived, not a hardcoded set.
  // Soft-delete is enforced on every leg so a deleted edition doesn't
  // surface through a surviving dub/subtitle. `Language.bcp47` has no
  // @map in admin's schema, so the DB column name matches the field
  // name; NULL bcp47 values are excluded because they're unindexable.
  const rows = await prisma.$queryRaw<
    Array<{
      video_id: string
      video_edition_id: string
      core_id: string
      bcp47: string
    }>
  >`
    WITH edition_languages AS (
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
    FROM edition_languages
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
      language: row.bcp47,
    })
  }

  return targets
}

/**
 * Group flat (video, edition, language) targets by (videoId,
 * videoEditionId). Preserves first-seen order so consumer logs and
 * tests stay deterministic. Each group's `targets` keep their
 * original enumeration order.
 *
 * Pure data transform — no Prisma access. Easy to unit-test in
 * isolation and replay-safe inside `"use workflow"`.
 */
function groupTargetsByVideoEdition(
  targets: readonly BackfillTarget[],
): BackfillGroup[] {
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
      // is `Omit<BackfillTarget, "language">`, so if BackfillTarget
      // gains anything new, this literal becomes incomplete and TS
      // flags it. First-seen `cmsVideoId` wins if upstream data ever
      // produces two targets for the same (videoId, videoEditionId)
      // with diverging cmsVideoIds.
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
 * Per-group worker. Loads the embeddings artifact ONCE, then fans out
 * per-language sequentially with the artifact in scope.
 *
 * Group-level artifact-load failure is cascaded to per-language
 * outcomes with the same classification the per-language path would
 * have produced (`artifact_missing` → skipped, anything else →
 * failed). This preserves Stage 1's per-target outcome shape so the
 * report's succeeded/skipped/failed triple stays meaningful even when
 * the load fault is shared.
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

  let loadedArtifact: EmbeddingsResult
  try {
    loadedArtifact = await stepLoadEmbeddingsArtifact(group.cmsVideoId)
  } catch (error) {
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
            language: target.language,
            reason,
            durationMs,
          }
        : {
            status: "failed",
            target,
            language: target.language,
            reason,
            durationMs,
          }
      logOutcome(outcome)
      return outcome
    })
  }

  // Per-language fan-out with the loaded artifact in scope. Sequential
  // inside the group so the artifact stays bounded to one stack frame
  // and the per-target step's timing measurement is honest.
  const outcomes: BackfillOutcome[] = []
  for (const target of group.targets) {
    const outcome = await _internals.stepIndexEditionTranscript(
      target,
      loadedArtifact,
    )
    logOutcome(outcome)
    outcomes.push(outcome)
  }
  return outcomes
}

async function stepIndexEditionTranscript(
  target: BackfillTarget,
  loadedArtifact: EmbeddingsResult,
): Promise<BackfillOutcome> {
  "use step"

  const startedAt = Date.now()

  try {
    const result = await indexEditionTranscript(prisma, {
      editionId: target.videoEditionId,
      videoId: target.videoId,
      coreId: target.coreId,
      language: target.language,
      cmsVideoId: target.cmsVideoId,
      loadedArtifact,
      user: SYSTEM_PRINCIPAL,
    })
    return toSucceeded(target, result, Date.now() - startedAt)
  } catch (error) {
    const durationMs = Date.now() - startedAt
    // Branch on the typed error class, not error-message regex. Only a
    // genuinely-missing artifact gets demoted to skipped; every other
    // error shape (ManagerArtifactError artifact_invalid /
    // artifact_read_failed, TranscriptIndexError dimension_mismatch /
    // empty_chunk_text, Prisma P2025, etc.) stays classified as failed
    // so the operator sees it in the report. With Stage 2's group-level
    // artifact load, an `artifact_missing` here would only fire if the
    // indexer's empty-`loadedArtifact` short-circuit somehow bypassed
    // the cache; keep the classification path intact for safety in
    // depth.
    if (
      error instanceof ManagerArtifactError &&
      error.code === "artifact_missing"
    ) {
      return {
        status: "skipped",
        target,
        language: target.language,
        reason: "artifact_missing",
        durationMs,
      }
    }
    const reason = error instanceof Error ? error.message : String(error)
    return {
      status: "failed",
      target,
      language: target.language,
      reason,
      durationMs,
    }
  }
}

/**
 * Project the outcome list to the deduped, sorted set of missing
 * embeddings artifacts. See R1's `deriveMissingArtifacts` for the full
 * rationale (dedup-by-assetId, ascending sort, first-seen-coreId
 * tiebreak, `failed`-outcomes excluded). The only difference here is
 * the literal `kind: "transcript"` stamp on each entry. Pure function —
 * no DB access, no side effects.
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
      kind: "transcript",
    })
  }
  return Array.from(byAssetId.values()).sort((a, b) => a.assetId - b.assetId)
}

function stepReport(args: {
  mappingGeneratedAt: string
  targets: number
  languageFilter: readonly string[] | null
  outcomes: BackfillOutcome[]
}): TranscriptEmbeddingBackfillReport {
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
    languageFilter: args.languageFilter,
    outcomes: args.outcomes,
    succeeded,
    skipped,
    failed,
    missingArtifacts: deriveMissingArtifacts(args.outcomes),
  }
}

function toSucceeded(
  target: BackfillTarget,
  result: IndexEditionTranscriptResult,
  durationMs: number,
): BackfillOutcome {
  return {
    status: "succeeded",
    target,
    language: result.language,
    chunksIndexed: result.chunksIndexed,
    embeddingsWritten: result.embeddingsWritten,
    chunksPruned: result.chunksPruned,
    durationMs,
  }
}

function logOutcome(outcome: BackfillOutcome): void {
  // Same defensive wrap R3 adopted: logOutcome runs OUTSIDE the
  // per-target try/catch, so a JSON.stringify throw would halt the
  // run and break per-target isolation.
  try {
    switch (outcome.status) {
      case "succeeded":
        console.log(
          JSON.stringify({
            workflow: "transcript-embedding-backfill",
            event: "transcript_index_complete",
            coreId: outcome.target.coreId,
            videoEditionId: outcome.target.videoEditionId,
            language: outcome.language,
            chunksIndexed: outcome.chunksIndexed,
            embeddingsWritten: outcome.embeddingsWritten,
            chunksPruned: outcome.chunksPruned,
            durationMs: outcome.durationMs,
          }),
        )
        return
      case "skipped":
        console.log(
          JSON.stringify({
            workflow: "transcript-embedding-backfill",
            event: "transcript_index_skipped",
            coreId: outcome.target.coreId,
            videoEditionId: outcome.target.videoEditionId,
            language: outcome.language,
            reason: outcome.reason,
            durationMs: outcome.durationMs,
          }),
        )
        return
      case "failed":
        console.error(
          JSON.stringify({
            workflow: "transcript-embedding-backfill",
            event: "transcript_index_failed",
            coreId: outcome.target.coreId,
            videoEditionId: outcome.target.videoEditionId,
            language: outcome.language,
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
      `[transcript-embedding-backfill] logOutcome failed: ${
        logErr instanceof Error ? logErr.message : String(logErr)
      }`,
    )
  }
}

// Exported for tests — pure helpers safe to exercise without the
// useworkflow runtime. `stepIndexEditionTranscript` is referenced
// through `_internals` from `processGroup` so tests can
// `vi.spyOn(_internals, "stepIndexEditionTranscript")` to force a
// `Promise.allSettled` rejection — the only way to exercise the
// synthetic-failed defensive branch, since the real step body catches
// everything internally.
export const _internals = {
  stepReport,
  stepIndexEditionTranscript,
  toSucceeded,
  logOutcome,
  groupTargetsByVideoEdition,
}
