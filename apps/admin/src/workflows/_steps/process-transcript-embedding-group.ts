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

type ManagerSourceLoadState =
  | { status: "not-attempted" }
  | { status: "resolved"; artifact: TranscriptSourceArtifact }
  | { status: "failed"; reason: string; missing: boolean }

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
  result: Extract<MastraTranscriptEmbeddingLaunchResult, { ok: true }>,
  durationMs: number,
): BackfillOutcome {
  return {
    status: "succeeded",
    target,
    language: target.language,
    sourceKind,
    chunksIndexed: result.chunks,
    embeddingsWritten: result.status === "unchanged" ? 0 : result.chunks,
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
 * One durable group step. Keep this as the only step boundary for group work:
 * creating child `"use step"` calls from inside the group worker corrupts the
 * production workflow event log.
 */
export async function stepProcessTranscriptEmbeddingGroup(
  group: BackfillGroup,
  mode: MastraTranscriptEmbeddingMode,
): Promise<BackfillOutcome[]> {
  "use step"

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
