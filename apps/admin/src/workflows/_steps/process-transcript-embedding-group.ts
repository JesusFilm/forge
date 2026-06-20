import pLimit from "p-limit"
import { prisma } from "@/db/client"
import {
  ManagerArtifactError,
  readTranscriptSourceArtifact,
  type TranscriptSourceArtifact,
} from "@/services/manager-artifacts.service"
import {
  launchMastraTranscriptEmbedding,
  type MastraTranscriptEmbeddingLaunchResult,
  type MastraTranscriptEmbeddingMode,
} from "@/services/mastra-transcript-embedding-client"
import {
  resolveSubtitleTranscriptSource,
  type ResolvedTranscriptEmbeddingSource,
  type TranscriptSourceGap,
} from "@/services/transcript-source-resolver.service"
import type {
  BackfillGroup,
  BackfillOutcome,
  BackfillTarget,
  TranscriptEmbeddingSourceGap,
} from "../transcriptEmbeddingBackfill"

const TIMED_OUT_LAUNCH_CONFIRM_TIMEOUT_MS = 20 * 60 * 1_000
const TIMED_OUT_LAUNCH_CONFIRM_POLL_MS = 5_000

type ManagerSourceLoadState =
  | { status: "not-attempted" }
  | { status: "resolved"; artifact: TranscriptSourceArtifact }
  | { status: "failed"; reason: string; missing: boolean }

type TranscriptIngestConfirmation = {
  chunks: number
  totalTokens: number
  model: string
  provider: string
  dimensions: number
  mastraRunId: string
  sourceContentHash: string
}

type TranscriptIngestConfirmationRow = {
  total_chunks: number | bigint
  total_tokens: number | bigint
  model: string
  dimensions: number
  embedding_provider: string | null
  source_content_hash: string | null
  healthy_chunks: number | bigint
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function managerTranscriptSourceFromArtifact(
  target: BackfillTarget,
  artifact: TranscriptSourceArtifact,
): ResolvedTranscriptEmbeddingSource {
  const sourceKey = `${target.cmsVideoId}/transcript.json`
  return {
    sourceKind: "manager-transcript",
    transcript: {
      text: artifact.text,
      segments: artifact.segments,
      artifactKey: sourceKey,
      kind: "manager-transcript",
      languageId: target.languageId,
      languageSlug: target.languageSlug,
      provider: artifact.resolvedProvider,
    },
    provenance: {
      sourceKind: "manager-transcript",
      sourceKey,
      language: artifact.language || target.language,
      languageId: target.languageId,
      languageSlug: target.languageSlug,
    },
  }
}

function sourceGapForMissingManager(
  target: BackfillTarget,
  subtitleGap?: TranscriptSourceGap,
): TranscriptEmbeddingSourceGap {
  const reason =
    target.hasDub && !target.hasSubtitle && !target.isPrimaryLanguage
      ? "dub_without_timed_text"
      : (subtitleGap?.reason ?? "artifact_missing")

  return {
    assetId: target.cmsVideoId,
    coreId: target.coreId,
    videoId: target.videoId,
    videoEditionId: target.videoEditionId,
    language: target.language,
    languageId: target.languageId,
    languageSlug: target.languageSlug,
    reason,
    subtitleReason: subtitleGap?.reason,
    subtitleId: subtitleGap?.subtitleId,
    subtitleFormat: subtitleGap?.format,
    sourceKind: "transcript",
  }
}

function toSucceeded(
  target: BackfillTarget,
  sourceKind: ResolvedTranscriptEmbeddingSource["sourceKind"],
  result:
    | Extract<MastraTranscriptEmbeddingLaunchResult, { ok: true }>
    | TranscriptIngestConfirmation,
  durationMs: number,
): BackfillOutcome {
  return {
    status: "succeeded",
    target,
    language: target.language,
    sourceKind,
    chunksIndexed: result.chunks,
    embeddingsWritten:
      "status" in result && result.status === "unchanged" ? 0 : result.chunks,
    chunksPruned: 0,
    durationMs,
  }
}

function logOutcome(outcome: BackfillOutcome): void {
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

async function readTranscriptIngestConfirmation(
  target: BackfillTarget,
  language: string,
  mastraRunId: string,
): Promise<TranscriptIngestConfirmation | null> {
  const rows = await prisma.$queryRaw<TranscriptIngestConfirmationRow[]>`
    SELECT
      vt.total_chunks,
      vt.total_tokens,
      vt.model,
      vt.dimensions,
      vt.embedding_provider,
      vt.source_content_hash,
      COUNT(vtc.id) FILTER (WHERE vtc.embedding IS NOT NULL) AS healthy_chunks
    FROM video_transcript vt
    LEFT JOIN video_transcript_chunk vtc
      ON vtc.transcript_id = vt.id
    WHERE vt.video_edition_id = ${target.videoEditionId}
      AND vt.language = ${language}
      AND vt.mastra_run_id = ${mastraRunId}
    GROUP BY vt.id
    LIMIT 1
  `
  const row = rows[0]
  if (!row) return null

  const chunks = Number(row.total_chunks)
  const healthyChunks = Number(row.healthy_chunks)
  if (!Number.isFinite(chunks) || chunks <= 0 || healthyChunks !== chunks) {
    return null
  }

  return {
    chunks,
    totalTokens: Number(row.total_tokens),
    model: row.model,
    provider: row.embedding_provider ?? "unknown",
    dimensions: Number(row.dimensions),
    mastraRunId,
    sourceContentHash: row.source_content_hash ?? "",
  }
}

async function waitForTimedOutLaunchIngest(
  target: BackfillTarget,
  language: string,
  mastraRunId: string,
): Promise<TranscriptIngestConfirmation | null> {
  const deadline = Date.now() + TIMED_OUT_LAUNCH_CONFIRM_TIMEOUT_MS

  while (Date.now() <= deadline) {
    const confirmation = await readTranscriptIngestConfirmation(
      target,
      language,
      mastraRunId,
    )
    if (confirmation) return confirmation
    await sleep(TIMED_OUT_LAUNCH_CONFIRM_POLL_MS)
  }

  return null
}

async function launchTranscriptEmbedding(
  target: BackfillTarget,
  transcriptSource: ResolvedTranscriptEmbeddingSource,
  mode: MastraTranscriptEmbeddingMode,
): Promise<BackfillOutcome> {
  const startedAt = Date.now()

  try {
    const result = await launchMastraTranscriptEmbedding({
      target: {
        videoId: target.videoId,
        videoEditionId: target.videoEditionId,
        coreId: target.coreId,
      },
      language: target.language,
      cmsVideoId: target.cmsVideoId,
      transcript: transcriptSource.transcript,
      mode,
    })
    if (!result.ok) {
      if (result.reason === "network_error" && result.mastraRunId) {
        const confirmation = await waitForTimedOutLaunchIngest(
          target,
          target.language,
          result.mastraRunId,
        )
        if (confirmation) {
          return toSucceeded(
            target,
            transcriptSource.sourceKind,
            confirmation,
            Date.now() - startedAt,
          )
        }
      }

      return {
        status: "failed",
        target,
        language: target.language,
        reason: result.reason,
        durationMs: Date.now() - startedAt,
      }
    }
    return toSucceeded(
      target,
      transcriptSource.sourceKind,
      result,
      Date.now() - startedAt,
    )
  } catch (error) {
    const durationMs = Date.now() - startedAt
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
 * Plain per-group worker. This deliberately is NOT a `"use step"` function:
 * production useworkflow gives every call to the same step function the same
 * step id, so dynamic groups.map(stepFn) fanout corrupts the event log.
 */
async function processTranscriptEmbeddingGroup(
  group: BackfillGroup,
  mode: MastraTranscriptEmbeddingMode,
): Promise<BackfillOutcome[]> {
  const groupStartedAt = Date.now()
  let managerSourceState: ManagerSourceLoadState = { status: "not-attempted" }

  const outcomes: BackfillOutcome[] = []
  for (const target of group.targets) {
    const subtitleResolution = await resolveSubtitleTranscriptSource(
      prisma,
      target,
    )
    let source: ResolvedTranscriptEmbeddingSource | null =
      subtitleResolution.status === "resolved"
        ? subtitleResolution.source
        : null

    if (!source) {
      if (managerSourceState.status === "not-attempted") {
        try {
          managerSourceState = {
            status: "resolved",
            artifact: await readTranscriptSourceArtifact(
              String(group.cmsVideoId),
            ),
          }
        } catch (error) {
          const missing =
            error instanceof ManagerArtifactError &&
            error.code === "artifact_missing"
          managerSourceState = {
            status: "failed",
            missing,
            reason: missing
              ? "artifact_missing"
              : error instanceof Error
                ? error.message
                : String(error),
          }
        }
      }

      if (managerSourceState.status === "resolved") {
        source = managerTranscriptSourceFromArtifact(
          target,
          managerSourceState.artifact,
        )
      } else if (managerSourceState.status === "failed") {
        const durationMs = Date.now() - groupStartedAt
        const sourceGap = sourceGapForMissingManager(
          target,
          subtitleResolution.status === "gap"
            ? subtitleResolution.gap
            : undefined,
        )
        const outcome: BackfillOutcome = managerSourceState.missing
          ? {
              status: "skipped",
              target,
              language: target.language,
              reason: sourceGap.reason,
              sourceGap,
              durationMs,
            }
          : {
              status: "failed",
              target,
              language: target.language,
              reason: managerSourceState.reason,
              durationMs,
            }
        logOutcome(outcome)
        outcomes.push(outcome)
        continue
      } else {
        throw new Error("internal transcript source resolver state was unset")
      }
    }

    const outcome = await launchTranscriptEmbedding(target, source, mode)
    logOutcome(outcome)
    outcomes.push(outcome)
  }
  return outcomes
}

/**
 * One durable step for all group work. Keep bounded parallelism inside this
 * step so the production workflow event log sees a single step event rather
 * than thousands of repeated dynamic group step events.
 */
export async function stepProcessTranscriptEmbeddingGroups(
  groups: readonly BackfillGroup[],
  mode: MastraTranscriptEmbeddingMode,
  concurrency: number,
): Promise<BackfillOutcome[]> {
  "use step"

  const limit = pLimit(concurrency)
  const batchStartedAt = Date.now()

  const settled = await Promise.allSettled(
    groups.map((group) =>
      limit(() => processTranscriptEmbeddingGroup(group, mode)),
    ),
  )

  return settled.flatMap((result, i) => {
    const group = groups[i]!
    if (result.status === "fulfilled") return result.value

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
}
