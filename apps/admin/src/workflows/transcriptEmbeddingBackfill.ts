// Transcript embedding backfill — durable useworkflow job that
// indexes manager's embeddings.json artifacts into admin's Postgres.
//
// Flow:
//   1. stepLoadMapping              — load coreId → cms video id snapshot
//   2. stepEnumerateTargets         — list admin editions whose parent video
//                                     has a coreId in the mapping; resolve
//                                     each target's primary-language BCP-47
//   3. stepIndexEditionTranscript   — per-target indexer call with
//                                     isolated error handling
//   4. stepReport                   — aggregate per-target outcomes
//
// Per-target errors are caught inside the loop so one bad artifact
// doesn't halt the backfill. The indexer itself is idempotent (upserts
// on (editionId, language) for the transcript and on (transcriptId,
// chunkIndex) for chunks), so the workflow is safe to re-run.
//
// Language model: manager currently writes ONE embeddings.json per
// asset — one source-language transcript. The workflow resolves each
// target's language from `Video.primaryLanguage.bcp47` (fallback "en")
// and calls the indexer once per target. The caller's `languages`
// filter, if supplied, narrows which targets are processed (not which
// artifacts are fetched; there's only one per asset today). A future
// multi-language artifact layout would extend enumeration additively.

import { prisma } from "@/db/client"
import type { Principal } from "@/auth/principal"
import {
  loadCoreIdMapping,
  type CoreIdMapping,
} from "@/services/core-id-mapping.service"
import { ManagerArtifactError } from "@/services/manager-artifacts.service"
import {
  indexEditionTranscript,
  type IndexEditionTranscriptResult,
} from "@/services/transcript-embedding.service"

const SYSTEM_PRINCIPAL = {
  id: null,
  role: "SYSTEM",
} as const satisfies Principal

const DEFAULT_LANGUAGE_FALLBACK = "en" as const

export type TranscriptEmbeddingBackfillInput = {
  /** S3 key of the JSON mapping snapshot uploaded via the admin refresh CLI. */
  mappingS3Key: string
  /** Restrict to these coreIds. Omitted = all mapped videos. */
  coreIds?: readonly string[]
  /**
   * Restrict to these BCP-47 languages. Omitted = accept whatever language
   * each target's Video.primaryLanguage.bcp47 resolves to.
   */
  languages?: readonly string[]
}

export type BackfillTarget = {
  videoId: string
  videoEditionId: string
  coreId: string
  cmsVideoId: number
  /**
   * BCP-47 language resolved from the target Video's primaryLanguage;
   * defaults to "en" when the video has no primary language set.
   * This is the language that will be stamped on the VideoTranscript
   * row the indexer writes.
   */
  language: string
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

export type TranscriptEmbeddingBackfillReport = {
  mappingGeneratedAt: string
  totalTargets: number
  languageFilter: readonly string[] | null
  outcomes: BackfillOutcome[]
  succeeded: number
  skipped: number
  failed: number
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
  // accept any resolved language" contract.
  const coreIdsFilter =
    input.coreIds && input.coreIds.length > 0 ? input.coreIds : undefined
  const languageFilter =
    input.languages && input.languages.length > 0 ? input.languages : null

  const allTargets = await stepEnumerateTargets(coreIdsFilter, mapping)
  const targets = languageFilter
    ? allTargets.filter((t) => languageFilter.includes(t.language))
    : allTargets

  const outcomes: BackfillOutcome[] = []
  for (const target of targets) {
    const outcome = await stepIndexEditionTranscript(target)
    outcomes.push(outcome)
    logOutcome(outcome)
  }

  return stepReport({
    mappingGeneratedAt: mapping.generatedAt,
    targets: targets.length,
    languageFilter,
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

  // Distinct (video, edition) pairs reachable through any non-deleted
  // dub, joined to the primary language for BCP-47 resolution. Raw SQL
  // is clearer than a Prisma relation query here because we need
  // distinct ids + a coalesced default for the language column.
  // Soft-delete is enforced on every leg so a deleted edition doesn't
  // surface through a surviving dub. `Language.bcp47` has no @map in
  // admin's schema, so the DB column name matches the field name.
  const rows = await prisma.$queryRaw<
    Array<{
      video_id: string
      video_edition_id: string
      core_id: string
      bcp47: string | null
    }>
  >`
    SELECT DISTINCT
      v.id AS video_id,
      e.id AS video_edition_id,
      v.core_id AS core_id,
      l.bcp47 AS bcp47
    FROM video v
    JOIN video_dub d ON d.video_id = v.id
    JOIN video_edition e ON e.id = d.video_edition_id
    LEFT JOIN language l ON l.id = v.primary_language_id
    WHERE v.deleted_at IS NULL
      AND d.deleted_at IS NULL
      AND e.deleted_at IS NULL
    ORDER BY v.core_id
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
      language: row.bcp47 ?? DEFAULT_LANGUAGE_FALLBACK,
    })
  }

  return targets
}

async function stepIndexEditionTranscript(
  target: BackfillTarget,
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
    // so the operator sees it in the report.
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
}

// Exported for tests — pure helpers safe to exercise without the
// useworkflow runtime. Tests using the step bodies import those
// directly through the workflow entry.
export const _internals = {
  stepReport,
  toSucceeded,
  logOutcome,
}
