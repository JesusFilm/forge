import { Prisma } from "@prisma/client"
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
  ACCEPTED_TRANSCRIPT_EMBEDDING_MODEL_STAMPS,
  EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
} from "@/services/transcript-embedding.service"
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
  | { status: "resolved"; artifact: TranscriptSourceArtifact }
  | { status: "failed"; reason: string; missing: boolean }

type ManagerSourceLoader = (
  cmsVideoId: number,
) => Promise<ManagerSourceLoadState>

type TranscriptIngestConfirmation = {
  chunks: number
  totalTokens: number
  model: string
  provider: string
  dimensions: number
  mastraRunId: string
  sourceContentHash: string
}

export type PendingTranscriptIngestConfirmation = {
  status: "pending-ingest-confirmation"
  target: BackfillTarget
  language: string
  sourceKind: ResolvedTranscriptEmbeddingSource["sourceKind"]
  mastraRunId: string
  startedAtEpochMs: number
}

export type TranscriptEmbeddingGroupBatchResult = {
  outcomes: BackfillOutcome[]
  pendingConfirmations: PendingTranscriptIngestConfirmation[]
  unprocessedGroups: BackfillGroup[]
}

export type TranscriptIngestConfirmationBatchResult = {
  outcomes: BackfillOutcome[]
  pendingConfirmations: PendingTranscriptIngestConfirmation[]
}

type TranscriptEmbeddingGroupResult =
  TranscriptIngestConfirmationBatchResult & {
    unprocessedGroup?: BackfillGroup
  }

type TranscriptEmbeddingDeferralBudget = {
  elapsedMs: number
  stepMaxDurationMs: number
  launchTimeoutMs: number
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

type ExistingTranscriptBackfillHealthRow = {
  video_edition_id: string
  language: string
  total_chunks: number | bigint
  model: string
  dimensions: number
  embedding_provider: string | null
  generation_mode: string | null
  source_kind: string | null
  chunks_with_embedding: number | bigint
  chunks_with_embedding_input_text: number | bigint
}

export const TRANSCRIPT_EMBEDDING_PROCESS_WAVE_SAFETY_BUFFER_MS = 30_000

function resumeTargetKey(videoEditionId: string, language: string): string {
  return `${videoEditionId}::${language}`
}

function targetResumeKey(target: BackfillTarget): string {
  return resumeTargetKey(target.videoEditionId, target.language)
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

function createManagerSourceLoader(): ManagerSourceLoader {
  const cache = new Map<number, Promise<ManagerSourceLoadState>>()

  return (cmsVideoId) => {
    const existing = cache.get(cmsVideoId)
    if (existing) return existing

    const loading = readTranscriptSourceArtifact(String(cmsVideoId))
      .then(
        (artifact): ManagerSourceLoadState => ({
          status: "resolved",
          artifact,
        }),
      )
      .catch((error): ManagerSourceLoadState => {
        const missing =
          error instanceof ManagerArtifactError &&
          error.code === "artifact_missing"
        return {
          status: "failed",
          missing,
          reason: missing
            ? "artifact_missing"
            : error instanceof Error
              ? error.message
              : String(error),
        }
      })

    cache.set(cmsVideoId, loading)
    return loading
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

function isHealthyEnrichedTranscriptForResume(
  row: ExistingTranscriptBackfillHealthRow,
): boolean {
  const totalChunks = Number(row.total_chunks)
  const chunksWithEmbedding = Number(row.chunks_with_embedding)
  const chunksWithEmbeddingInputText = Number(
    row.chunks_with_embedding_input_text,
  )

  return (
    Number.isFinite(totalChunks) &&
    totalChunks > 0 &&
    row.generation_mode === "model-upgrade" &&
    row.source_kind != null &&
    row.source_kind.length > 0 &&
    ACCEPTED_TRANSCRIPT_EMBEDDING_MODEL_STAMPS.has(row.model) &&
    row.dimensions === EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS &&
    row.embedding_provider === "jesus-film-ai-gateway" &&
    chunksWithEmbedding === totalChunks &&
    chunksWithEmbeddingInputText === totalChunks
  )
}

async function readHealthyEnrichedTranscriptResumeKeys(
  targets: readonly BackfillTarget[],
): Promise<ReadonlySet<string>> {
  if (targets.length === 0) return new Set()

  const uniqueTargets = Array.from(
    new Map(
      targets.map((target) => [targetResumeKey(target), target]),
    ).values(),
  )
  const rows = await prisma.$queryRaw<ExistingTranscriptBackfillHealthRow[]>`
    WITH target(video_edition_id, language) AS (
      VALUES ${Prisma.join(
        uniqueTargets.map(
          (target) =>
            Prisma.sql`(${target.videoEditionId}, ${target.language})`,
        ),
      )}
    )
    SELECT
      vt.video_edition_id,
      vt.language,
      vt.total_chunks,
      vt.model,
      vt.dimensions,
      vt.embedding_provider,
      vt.generation_mode,
      vt.source_kind,
      COUNT(vtc.id) FILTER (
        WHERE vtc.embedding IS NOT NULL
      ) AS chunks_with_embedding,
      COUNT(vtc.id) FILTER (
        WHERE vtc.embedding_input_text IS NOT NULL
          AND length(vtc.embedding_input_text) > 0
      ) AS chunks_with_embedding_input_text
    FROM video_transcript vt
    JOIN target t
      ON t.video_edition_id = vt.video_edition_id
      AND t.language = vt.language
    LEFT JOIN video_transcript_chunk vtc
      ON vtc.transcript_id = vt.id
    GROUP BY vt.id
  `

  return new Set(
    rows
      .filter(isHealthyEnrichedTranscriptForResume)
      .map((row) => resumeTargetKey(row.video_edition_id, row.language)),
  )
}

async function launchTranscriptEmbedding(
  target: BackfillTarget,
  transcriptSource: ResolvedTranscriptEmbeddingSource,
  mode: MastraTranscriptEmbeddingMode,
  launchTimeoutMs: number,
): Promise<BackfillOutcome | PendingTranscriptIngestConfirmation> {
  const startedAt = Date.now()

  try {
    const result = await launchMastraTranscriptEmbedding(
      {
        target: {
          videoId: target.videoId,
          videoEditionId: target.videoEditionId,
          coreId: target.coreId,
        },
        language: target.language,
        cmsVideoId: target.cmsVideoId,
        transcript: transcriptSource.transcript,
        mode,
      },
      { timeoutMs: launchTimeoutMs },
    )
    if (!result.ok) {
      if (result.reason === "network_error" && result.mastraRunId) {
        const pending: PendingTranscriptIngestConfirmation = {
          status: "pending-ingest-confirmation",
          target,
          language: target.language,
          sourceKind: transcriptSource.sourceKind,
          mastraRunId: result.mastraRunId,
          startedAtEpochMs: startedAt,
        }
        logPendingConfirmation(pending)
        return pending
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

function logPendingConfirmation(
  pending: PendingTranscriptIngestConfirmation,
): void {
  try {
    console.log(
      JSON.stringify({
        workflow: "transcript-embedding-backfill",
        event: "transcript_index_pending_ingest_confirmation",
        coreId: pending.target.coreId,
        videoEditionId: pending.target.videoEditionId,
        language: pending.language,
        sourceKind: pending.sourceKind,
        mastraRunId: pending.mastraRunId,
      }),
    )
  } catch (logErr) {
    console.error(
      `[transcript-embedding-backfill] logPendingConfirmation failed: ${
        logErr instanceof Error ? logErr.message : String(logErr)
      }`,
    )
  }
}

function logTargetDeferral(
  group: BackfillGroup,
  targetIndex: number,
  budget: TranscriptEmbeddingDeferralBudget,
): void {
  try {
    console.log(
      JSON.stringify({
        workflow: "transcript-embedding-backfill",
        event: "transcript_index_target_deferred",
        coreId: group.coreId,
        videoEditionId: group.videoEditionId,
        processedTargets: targetIndex,
        remainingTargets: group.targets.length - targetIndex,
        elapsedMs: budget.elapsedMs,
        stepMaxDurationMs: budget.stepMaxDurationMs,
        launchTimeoutMs: budget.launchTimeoutMs,
      }),
    )
  } catch (logErr) {
    console.error(
      `[transcript-embedding-backfill] logTargetDeferral failed: ${
        logErr instanceof Error ? logErr.message : String(logErr)
      }`,
    )
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
  loadManagerSource: ManagerSourceLoader,
  launchTimeoutMs: number,
  healthyResumeTargets: ReadonlySet<string>,
  batchStartedAt: number,
  stepMaxDurationMs: number,
): Promise<TranscriptEmbeddingGroupResult> {
  const groupStartedAt = Date.now()

  const outcomes: BackfillOutcome[] = []
  const pendingConfirmations: PendingTranscriptIngestConfirmation[] = []
  const deferFrom = (
    targetIndex: number,
    budget: TranscriptEmbeddingDeferralBudget,
  ): TranscriptEmbeddingGroupResult => {
    logTargetDeferral(group, targetIndex, budget)
    return {
      outcomes,
      pendingConfirmations,
      unprocessedGroup: {
        ...group,
        targets: group.targets.slice(targetIndex),
      },
    }
  }

  for (const [targetIndex, target] of group.targets.entries()) {
    const preResolutionBudget = {
      elapsedMs: Date.now() - batchStartedAt,
      stepMaxDurationMs,
      launchTimeoutMs,
    }
    if (
      shouldDeferNextTranscriptEmbeddingLaunch({
        launchesStarted: targetIndex,
        ...preResolutionBudget,
      })
    ) {
      return deferFrom(targetIndex, preResolutionBudget)
    }

    const targetStartedAt = Date.now()
    if (
      mode === "model-upgrade" &&
      healthyResumeTargets.has(targetResumeKey(target))
    ) {
      const outcome: BackfillOutcome = {
        status: "skipped",
        target,
        language: target.language,
        reason: "already_enriched_healthy",
        durationMs: Date.now() - targetStartedAt,
      }
      logOutcome(outcome)
      outcomes.push(outcome)
      continue
    }

    const subtitleResolution = await resolveSubtitleTranscriptSource(
      prisma,
      target,
    )
    let source: ResolvedTranscriptEmbeddingSource | null =
      subtitleResolution.status === "resolved"
        ? subtitleResolution.source
        : null

    if (!source) {
      const managerSourceState = await loadManagerSource(group.cmsVideoId)

      if (managerSourceState.status === "failed") {
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
      }

      source = managerTranscriptSourceFromArtifact(
        target,
        managerSourceState.artifact,
      )
    }

    const preLaunchBudget = {
      elapsedMs: Date.now() - batchStartedAt,
      stepMaxDurationMs,
      launchTimeoutMs,
    }
    if (
      shouldDeferNextTranscriptEmbeddingLaunch({
        launchesStarted: targetIndex,
        ...preLaunchBudget,
      })
    ) {
      return deferFrom(targetIndex, preLaunchBudget)
    }

    const outcome = await launchTranscriptEmbedding(
      target,
      source,
      mode,
      launchTimeoutMs,
    )
    if (outcome.status === "pending-ingest-confirmation") {
      pendingConfirmations.push(outcome)
    } else {
      logOutcome(outcome)
      outcomes.push(outcome)
    }
  }
  return { outcomes, pendingConfirmations }
}

/**
 * One durable step for a bounded batch of group work. Keep parallelism inside
 * this step so the production workflow event log sees sequential batch steps
 * rather than repeated dynamic group step fanout.
 */
export async function stepProcessTranscriptEmbeddingGroups(
  groups: readonly BackfillGroup[],
  mode: MastraTranscriptEmbeddingMode,
  concurrency: number,
  stepMaxDurationMs: number,
  launchTimeoutMs: number,
): Promise<TranscriptEmbeddingGroupBatchResult> {
  "use step"

  const safeConcurrency =
    Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 1
  const safeStepMaxDurationMs =
    Number.isInteger(stepMaxDurationMs) && stepMaxDurationMs > 0
      ? stepMaxDurationMs
      : 220_000
  const batchStartedAt = Date.now()
  const loadManagerSource = createManagerSourceLoader()
  const healthyResumeTargets =
    mode === "model-upgrade"
      ? await readHealthyEnrichedTranscriptResumeKeys(
          groups.flatMap((group) => group.targets),
        )
      : new Set<string>()

  const outcomes: BackfillOutcome[] = []
  const pendingConfirmations: PendingTranscriptIngestConfirmation[] = []
  const unprocessedGroups: BackfillGroup[] = []
  let wavesStarted = 0

  for (let i = 0; i < groups.length; i += safeConcurrency) {
    if (
      shouldDeferNextTranscriptEmbeddingLaunch({
        launchesStarted: wavesStarted,
        elapsedMs: Date.now() - batchStartedAt,
        stepMaxDurationMs: safeStepMaxDurationMs,
        launchTimeoutMs,
      })
    ) {
      unprocessedGroups.push(...groups.slice(i))
      break
    }

    const wave = groups.slice(i, i + safeConcurrency)
    wavesStarted += 1
    const settled = await Promise.allSettled(
      wave.map((group) =>
        processTranscriptEmbeddingGroup(
          group,
          mode,
          loadManagerSource,
          launchTimeoutMs,
          healthyResumeTargets,
          batchStartedAt,
          safeStepMaxDurationMs,
        ),
      ),
    )

    for (const [waveIndex, result] of settled.entries()) {
      const group = wave[waveIndex]!
      if (result.status === "fulfilled") {
        outcomes.push(...result.value.outcomes)
        pendingConfirmations.push(...result.value.pendingConfirmations)
        if (result.value.unprocessedGroup) {
          unprocessedGroups.push(result.value.unprocessedGroup)
        }
        continue
      }

      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      const durationMs = Date.now() - batchStartedAt

      for (const target of group.targets) {
        const synthetic: BackfillOutcome = {
          status: "failed",
          target,
          language: target.language,
          reason,
          durationMs,
        }
        logOutcome(synthetic)
        outcomes.push(synthetic)
      }
    }
  }

  return { outcomes, pendingConfirmations, unprocessedGroups }
}

export function shouldDeferNextTranscriptEmbeddingLaunch({
  launchesStarted,
  elapsedMs,
  stepMaxDurationMs,
  launchTimeoutMs,
  safetyBufferMs = TRANSCRIPT_EMBEDDING_PROCESS_WAVE_SAFETY_BUFFER_MS,
}: {
  launchesStarted: number
  elapsedMs: number
  stepMaxDurationMs: number
  launchTimeoutMs: number
  safetyBufferMs?: number
}): boolean {
  if (launchesStarted <= 0) return false

  const safeElapsedMs =
    Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0
  const safeStepMaxDurationMs =
    Number.isFinite(stepMaxDurationMs) && stepMaxDurationMs > 0
      ? stepMaxDurationMs
      : 0
  const safeLaunchTimeoutMs =
    Number.isFinite(launchTimeoutMs) && launchTimeoutMs > 0
      ? launchTimeoutMs
      : 0
  const safeSafetyBufferMs =
    Number.isFinite(safetyBufferMs) && safetyBufferMs > 0 ? safetyBufferMs : 0

  if (safeElapsedMs >= safeStepMaxDurationMs) return true

  const remainingBudgetMs = safeStepMaxDurationMs - safeElapsedMs
  return remainingBudgetMs <= safeLaunchTimeoutMs + safeSafetyBufferMs
}

export async function stepConfirmTranscriptEmbeddingIngests(
  pendingConfirmations: readonly PendingTranscriptIngestConfirmation[],
): Promise<TranscriptIngestConfirmationBatchResult> {
  "use step"

  const outcomes: BackfillOutcome[] = []
  const pending: PendingTranscriptIngestConfirmation[] = []

  for (const confirmation of pendingConfirmations) {
    const result = await readTranscriptIngestConfirmation(
      confirmation.target,
      confirmation.language,
      confirmation.mastraRunId,
    )

    if (!result) {
      pending.push(confirmation)
      continue
    }

    const outcome = toSucceeded(
      confirmation.target,
      confirmation.sourceKind,
      result,
      Date.now() - confirmation.startedAtEpochMs,
    )
    logOutcome(outcome)
    outcomes.push(outcome)
  }

  return { outcomes, pendingConfirmations: pending }
}

export async function stepFailPendingTranscriptEmbeddingIngests(
  pendingConfirmations: readonly PendingTranscriptIngestConfirmation[],
): Promise<BackfillOutcome[]> {
  "use step"

  return pendingConfirmations.map((confirmation) => {
    const outcome: BackfillOutcome = {
      status: "failed",
      target: confirmation.target,
      language: confirmation.language,
      reason: "network_error",
      durationMs: Date.now() - confirmation.startedAtEpochMs,
    }
    logOutcome(outcome)
    return outcome
  })
}
