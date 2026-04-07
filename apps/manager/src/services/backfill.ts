// Backfill orchestrator — processes the Phase 1 video catalog through the
// scene vectorization pipeline and indexes results into pgvector.
//
// Follows the blurhash-backfill pattern: in-memory status, cancel support,
// fire-and-forget from API route. Progress persists in scene_embeddings table.

import {
  fetchBackfillQueue,
  fetchProcessedKeys,
} from "@/services/backfillQueue"
import { processVideoForBackfill } from "@/services/sceneEmbedder"

const MAX_ERROR_LOG = 50

// ── Cost model (OpenRouter pricing for Gemini 2.5 Flash + text-embedding-3-small) ──
const INPUT_COST_PER_TOKEN = 0.15 / 1_000_000
const OUTPUT_COST_PER_TOKEN = 0.6 / 1_000_000
const EMBEDDING_COST_PER_TOKEN = 0.02 / 1_000_000

// Dry-run estimation constants (from R0 data audit)
const AVG_SCENES_PER_VIDEO = 3.5
const AVG_INPUT_TOKENS_PER_SCENE = 16_300
const AVG_OUTPUT_TOKENS_PER_SCENE = 800
const AVG_EMBEDDING_TOKENS_PER_SCENE = 200

export type BackfillConfig = {
  batchSize: number
  costThresholdUsd: number
  dryRun: boolean
  rateLimitDelayMs: number
}

const DEFAULT_CONFIG: BackfillConfig = {
  batchSize: 100,
  costThresholdUsd: 500,
  dryRun: false,
  rateLimitDelayMs: 2000,
}

type ErrorEntry = {
  videoId: number
  title: string | null
  error: string
  at: string
}

export type BackfillStatus = {
  running: boolean
  cancelled: boolean
  dryRun: boolean
  config: BackfillConfig
  total: number
  queued: number
  processed: number
  skipped: number
  errors: number
  totalScenes: number
  totalInputTokens: number
  totalOutputTokens: number
  totalEmbeddingTokens: number
  estimatedCostUsd: number
  startedAt: string | null
  completedAt: string | null
  currentVideoId: number | null
  currentVideoTitle: string | null
  errorLog: ErrorEntry[]
}

function computeCost(
  inputTokens: number,
  outputTokens: number,
  embeddingTokens: number,
): number {
  return (
    inputTokens * INPUT_COST_PER_TOKEN +
    outputTokens * OUTPUT_COST_PER_TOKEN +
    embeddingTokens * EMBEDDING_COST_PER_TOKEN
  )
}

let status: BackfillStatus = {
  running: false,
  cancelled: false,
  dryRun: false,
  config: DEFAULT_CONFIG,
  total: 0,
  queued: 0,
  processed: 0,
  skipped: 0,
  errors: 0,
  totalScenes: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalEmbeddingTokens: 0,
  estimatedCostUsd: 0,
  startedAt: null,
  completedAt: null,
  currentVideoId: null,
  currentVideoTitle: null,
  errorLog: [],
}

export function getBackfillStatus(): BackfillStatus {
  return { ...status, errorLog: [...status.errorLog] }
}

export function cancelBackfill(): boolean {
  if (!status.running) return false
  status.cancelled = true
  return true
}

/**
 * Synchronously claim the backfill lock and reset status.
 * Call this BEFORE dispatching after() to prevent TOCTOU races
 * where two concurrent POST /start both see running=false.
 * Returns false if already running.
 */
export function claimBackfill(userConfig?: Partial<BackfillConfig>): boolean {
  if (status.running) return false

  const config: BackfillConfig = { ...DEFAULT_CONFIG, ...userConfig }

  status = {
    running: true,
    cancelled: false,
    dryRun: config.dryRun,
    config,
    total: 0,
    queued: 0,
    processed: 0,
    skipped: 0,
    errors: 0,
    totalScenes: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalEmbeddingTokens: 0,
    estimatedCostUsd: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    currentVideoId: null,
    currentVideoTitle: null,
    errorLog: [],
  }

  return true
}

export async function startBackfill(): Promise<void> {
  // claimBackfill must be called before this function.
  if (!status.running) {
    throw new Error("claimBackfill must be called before startBackfill")
  }

  const config = status.config

  try {
    // 1. Fetch full queue from CMS
    console.log(JSON.stringify({ event: "backfill_fetching_queue" }))
    const fullQueue = await fetchBackfillQueue()
    status.total = fullQueue.length

    // 2. Filter out already-processed videos
    const processedKeys = await fetchProcessedKeys()
    const pending = fullQueue.filter(
      (v) => !processedKeys.has(`${v.videoId}:${v.subtitleLanguage}`),
    )
    status.skipped = fullQueue.length - pending.length

    // 3. Apply batch size limit
    const batch = pending.slice(0, config.batchSize)
    status.queued = batch.length

    console.log(
      JSON.stringify({
        event: "backfill_queue_ready",
        total: fullQueue.length,
        alreadyProcessed: status.skipped,
        queued: batch.length,
        dryRun: config.dryRun,
      }),
    )

    // 4. Dry-run: estimate cost and return
    if (config.dryRun) {
      const totalScenes = batch.length * AVG_SCENES_PER_VIDEO
      const totalInput = totalScenes * AVG_INPUT_TOKENS_PER_SCENE
      const totalOutput = totalScenes * AVG_OUTPUT_TOKENS_PER_SCENE
      const totalEmbed = totalScenes * AVG_EMBEDDING_TOKENS_PER_SCENE

      status.totalScenes = Math.round(totalScenes)
      status.totalInputTokens = Math.round(totalInput)
      status.totalOutputTokens = Math.round(totalOutput)
      status.totalEmbeddingTokens = Math.round(totalEmbed)
      status.estimatedCostUsd = computeCost(totalInput, totalOutput, totalEmbed)
      status.processed = 0

      console.log(
        JSON.stringify({
          event: "backfill_dry_run_estimate",
          videos: batch.length,
          estimatedScenes: status.totalScenes,
          estimatedCostUsd: Number(status.estimatedCostUsd.toFixed(2)),
        }),
      )
      return
    }

    // 5. Process each video
    for (const video of batch) {
      if (status.cancelled) {
        console.log(
          JSON.stringify({
            event: "backfill_cancelled",
            processed: status.processed,
            errors: status.errors,
          }),
        )
        break
      }

      // Check cost threshold
      if (status.estimatedCostUsd >= config.costThresholdUsd) {
        console.log(
          JSON.stringify({
            event: "backfill_cost_threshold_reached",
            estimatedCostUsd: Number(status.estimatedCostUsd.toFixed(2)),
            threshold: config.costThresholdUsd,
            processed: status.processed,
          }),
        )
        break
      }

      status.currentVideoId = video.videoId
      status.currentVideoTitle = video.title

      try {
        const result = await processVideoForBackfill(video)

        status.processed++
        status.totalScenes += result.sceneCount
        status.totalInputTokens += result.totalInputTokens
        status.totalOutputTokens += result.totalOutputTokens
        status.totalEmbeddingTokens += result.embeddingTokens
        status.estimatedCostUsd = computeCost(
          status.totalInputTokens,
          status.totalOutputTokens,
          status.totalEmbeddingTokens,
        )

        console.log(
          JSON.stringify({
            event: "backfill_video_complete",
            videoId: video.videoId,
            title: video.title,
            label: video.label,
            sceneCount: result.sceneCount,
            inputTokens: result.totalInputTokens,
            outputTokens: result.totalOutputTokens,
            embeddingTokens: result.embeddingTokens,
            durationMs: result.durationMs,
            cumulativeCostUsd: Number(status.estimatedCostUsd.toFixed(4)),
            progress: `${status.processed}/${status.queued}`,
          }),
        )
      } catch (err) {
        status.errors++
        const message = err instanceof Error ? err.message : String(err)

        if (status.errorLog.length >= MAX_ERROR_LOG) {
          status.errorLog.shift()
        }
        status.errorLog.push({
          videoId: video.videoId,
          title: video.title,
          error: message.slice(0, 500),
          at: new Date().toISOString(),
        })

        console.error(
          JSON.stringify({
            event: "backfill_video_error",
            videoId: video.videoId,
            title: video.title,
            error: message,
            progress: `${status.processed}/${status.queued}`,
          }),
        )
      }

      // Rate limit delay between videos
      if (config.rateLimitDelayMs > 0) {
        await delay(config.rateLimitDelayMs)
      }
    }

    console.log(
      JSON.stringify({
        event: "backfill_complete",
        processed: status.processed,
        errors: status.errors,
        totalScenes: status.totalScenes,
        estimatedCostUsd: Number(status.estimatedCostUsd.toFixed(2)),
        cancelled: status.cancelled,
      }),
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      JSON.stringify({ event: "backfill_fatal_error", error: message }),
    )
  } finally {
    status.running = false
    status.currentVideoId = null
    status.currentVideoTitle = null
    status.completedAt = new Date().toISOString()
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
