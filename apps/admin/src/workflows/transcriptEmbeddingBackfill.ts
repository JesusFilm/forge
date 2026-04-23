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
// Language model: the workflow enumerates one target per
// `(video, edition, bcp47)` triple, where the language set is derived
// from the content itself — the union of each video's primary
// language, its edition's subtitle languages, and its edition's dub
// languages. This is "every locale that exists for this video" per
// the admin-migration playbook's eventual goal. Manager currently
// writes ONE `{assetId}/embeddings.json` per asset (single
// source-language transcript), so indexing per-language today writes
// identical chunk text/vectors under N different `language` stamps —
// the schema is future-ready for per-language artifacts that manager
// will produce later without any admin-side enumeration change. The
// caller's `languages` filter, if supplied, narrows which BCP-47 tags
// are processed; omitted means all data-derived languages.
//
// Historical note: an earlier prototype hardcoded a fallback to `en`
// and a `DEFAULT_LOCALES = ['en', 'es', 'fr']` constant. Both were
// dropped once the enumeration became data-derived.

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

  const outcomes: BackfillOutcome[] = []
  for (const target of targets) {
    const outcome = await stepIndexEditionTranscript(target)
    outcomes.push(outcome)
    logOutcome(outcome)
  }

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
