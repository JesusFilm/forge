// Transcript embedding backfill — durable useworkflow job that launches
// Mastra from manager's transcript.json source artifacts.
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
//                                     transcript source artifact is shared
//                                     across every language in a group,
//                                     so fetching it once per group
//                                     collapses S3 reads from N×L to N.
//   4. stepProcessTranscriptEmbeddingGroups — one durable step that:
//        4a. Load transcript source artifact ONCE for the group.
//        4b. For each language in the group, call Mastra with Admin
//            target identifiers so Mastra embeds and Admin ingest stores.
//   5. stepReport                   — aggregate per-target outcomes.
//
// feat-132 boundary: Admin never imports manager-generated transcript
// vectors. Admin reads transcript source only; Mastra owns chunking and
// provider calls; Admin ingest owns vector storage.
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

import { prisma } from "@/db/client"
import { env } from "@/config/env"
import {
  loadCoreIdMapping,
  type CoreIdMapping,
} from "@/services/core-id-mapping.service"
import { type MastraTranscriptEmbeddingMode } from "@/services/mastra-transcript-embedding-client"
import type {
  ResolvedTranscriptEmbeddingSource,
  TranscriptSourceGap,
} from "@/services/transcript-source-resolver.service"
import { stepProcessTranscriptEmbeddingGroups } from "./_steps/process-transcript-embedding-group"

/**
 * Default per-group concurrency for the Mastra transcript-embedding
 * backfill. Stage 2: the unit changed from per-target to per-(video,
 * edition) GROUP. feat-132 makes each target a Mastra launch plus an
 * Admin ingest callback, so the default stays below admin's documented
 * `connection_limit=10` Prisma pool while also avoiding a provider-call
 * burst from local backfills.
 *
 * Memory budget per active group stays small because Admin only keeps
 * the transcript source artifact in scope before handing chunking and
 * provider work to Mastra.
 */
export const DEFAULT_TRANSCRIPT_EMBEDDING_CONCURRENCY = 5

function transcriptEmbeddingConcurrency(): number {
  const value =
    env.TRANSCRIPT_EMBEDDING_CONCURRENCY ??
    DEFAULT_TRANSCRIPT_EMBEDDING_CONCURRENCY
  const concurrency = Number(value)

  return Number.isInteger(concurrency) && concurrency > 0
    ? concurrency
    : DEFAULT_TRANSCRIPT_EMBEDDING_CONCURRENCY
}

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
  /** Mastra/Admin ingest generation mode. Defaults to idempotent. */
  mode?: MastraTranscriptEmbeddingMode
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
  /** Admin language row identity. BCP-47 is not unique enough for source selection. */
  languageId: string
  languageSlug: string | null
  hasSubtitle: boolean
  hasDub: boolean
  isPrimaryLanguage: boolean
}

/**
 * One group per (videoId, videoEditionId). Stage 2 groups flat targets
 * along this axis so the manager-artifacts S3 read happens once and
 * the loaded transcript source artifact is reused across every language in
 * the group.
 *
 * `targets` order is preserved from enumeration; the launcher fans out
 * sequentially across that order inside the group worker.
 */
export type BackfillGroup = Pick<
  BackfillTarget,
  "videoId" | "videoEditionId" | "coreId" | "cmsVideoId"
> & {
  targets: readonly BackfillTarget[]
}

export type TranscriptEmbeddingSourceGap = {
  readonly assetId: number
  readonly coreId: string
  readonly videoId: string
  readonly videoEditionId: string
  readonly language: string
  readonly languageId: string
  readonly languageSlug: string | null
  readonly reason:
    | TranscriptSourceGap["reason"]
    | "artifact_missing"
    | "dub_without_timed_text"
  readonly subtitleReason?: TranscriptSourceGap["reason"]
  readonly subtitleId?: string
  readonly subtitleFormat?: "vtt" | "srt"
  readonly sourceKind: "transcript"
}

export type BackfillOutcome =
  | {
      status: "succeeded"
      target: BackfillTarget
      language: string
      sourceKind: ResolvedTranscriptEmbeddingSource["sourceKind"]
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
      sourceGap?: TranscriptEmbeddingSourceGap
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
   * had its transcript source artifact present. See `MissingArtifact`.
   */
  missingArtifacts: ReadonlyArray<MissingArtifact>
  sourceGaps: ReadonlyArray<TranscriptEmbeddingSourceGap>
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

  // Bounded parallelism is intentionally inside one durable step below.
  // Production useworkflow rejects dynamic repeated calls to the same step
  // function from a groups.map(...) loop with event-log corruption.
  const concurrency = transcriptEmbeddingConcurrency()

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

  const outcomes = await stepProcessTranscriptEmbeddingGroups(
    groups,
    input.mode ?? "idempotent",
    concurrency,
  )

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
      language_id: string
      bcp47: string
      slug: string | null
      has_subtitle: boolean
      has_dub: boolean
      is_primary_language: boolean
    }>
  >`
    WITH target_language_sources AS (
      SELECT
        v.id AS video_id,
        e.id AS video_edition_id,
        v.core_id AS core_id,
        l.id AS language_id,
        l.bcp47 AS bcp47,
        l.slug AS slug,
        false AS has_subtitle,
        false AS has_dub,
        true AS is_primary_language
      FROM video v
      JOIN video_dub d ON d.video_id = v.id AND d.deleted_at IS NULL
      JOIN video_edition e ON e.id = d.video_edition_id AND e.deleted_at IS NULL
      JOIN language l ON l.id = v.primary_language_id
      WHERE v.deleted_at IS NULL
        AND l.bcp47 IS NOT NULL

      UNION ALL

      SELECT
        v.id,
        e.id,
        v.core_id,
        l.id,
        l.bcp47,
        l.slug,
        true AS has_subtitle,
        false AS has_dub,
        false AS is_primary_language
      FROM video v
      JOIN video_dub d ON d.video_id = v.id AND d.deleted_at IS NULL
      JOIN video_edition e ON e.id = d.video_edition_id AND e.deleted_at IS NULL
      JOIN video_subtitle s ON s.video_edition_id = e.id AND s.deleted_at IS NULL
      JOIN language l ON l.id = s.language_id
      WHERE v.deleted_at IS NULL
        AND l.bcp47 IS NOT NULL

      UNION ALL

      SELECT
        v.id,
        e.id,
        v.core_id,
        l.id,
        l.bcp47,
        l.slug,
        false AS has_subtitle,
        true AS has_dub,
        false AS is_primary_language
      FROM video v
      JOIN video_dub d ON d.video_id = v.id AND d.deleted_at IS NULL
      JOIN video_edition e ON e.id = d.video_edition_id AND e.deleted_at IS NULL
      JOIN language l ON l.id = d.language_id
      WHERE v.deleted_at IS NULL
        AND l.bcp47 IS NOT NULL
    )
    SELECT
      video_id,
      video_edition_id,
      core_id,
      language_id,
      bcp47,
      slug,
      bool_or(has_subtitle) AS has_subtitle,
      bool_or(has_dub) AS has_dub,
      bool_or(is_primary_language) AS is_primary_language
    FROM target_language_sources
    GROUP BY video_id, video_edition_id, core_id, language_id, bcp47, slug
    ORDER BY core_id, bcp47, slug
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
      languageId: row.language_id,
      languageSlug: row.slug,
      hasSubtitle: row.has_subtitle,
      hasDub: row.has_dub,
      isPrimaryLanguage: row.is_primary_language,
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
 * Project the outcome list to the deduped, sorted set of missing
 * transcript source artifacts. See R1's `deriveMissingArtifacts` for the full
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
    if (outcome.reason !== "artifact_missing" && !outcome.sourceGap) continue
    if (byAssetId.has(outcome.target.cmsVideoId)) continue
    byAssetId.set(outcome.target.cmsVideoId, {
      assetId: outcome.target.cmsVideoId,
      coreId: outcome.target.coreId,
      kind: "transcript",
    })
  }
  return Array.from(byAssetId.values()).sort((a, b) => a.assetId - b.assetId)
}

function deriveSourceGaps(
  outcomes: readonly BackfillOutcome[],
): TranscriptEmbeddingSourceGap[] {
  const byKey = new Map<string, TranscriptEmbeddingSourceGap>()
  for (const outcome of outcomes) {
    if (outcome.status !== "skipped" || !outcome.sourceGap) continue
    const key = [
      outcome.sourceGap.assetId,
      outcome.sourceGap.videoEditionId,
      outcome.sourceGap.languageId,
      outcome.sourceGap.reason,
    ].join("::")
    if (!byKey.has(key)) byKey.set(key, outcome.sourceGap)
  }
  return Array.from(byKey.values()).sort((a, b) => {
    if (a.assetId !== b.assetId) return a.assetId - b.assetId
    return a.language.localeCompare(b.language)
  })
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
    sourceGaps: deriveSourceGaps(args.outcomes),
  }
}

// Exported for tests — pure helpers safe to exercise without the
// useworkflow runtime.
export const _internals = {
  stepReport,
  groupTargetsByVideoEdition,
}
