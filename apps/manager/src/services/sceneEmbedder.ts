// Scene embedder — bridges scene analysis pipeline to CMS embedding indexer.
// Per-video: run pipeline -> embed descriptions -> POST to CMS indexer.

import { readArtifact } from "@/services/storage"
import { syncSceneAnalysisEmbeddings } from "@/services/sceneEmbeddingSync"
import { runSceneAnalysisPipeline } from "@/workflows/sceneAnalysisPipeline"
import type { SceneAnalysisResult } from "@/services/sceneAnalysis"
import type { BackfillVideo } from "@/services/backfillQueue"

export type VideoProcessResult = {
  videoId: number
  sceneCount: number
  totalInputTokens: number
  totalOutputTokens: number
  embeddingTokens: number
  durationMs: number
}

export async function processVideoForBackfill(
  video: BackfillVideo,
): Promise<VideoProcessResult> {
  const start = Date.now()

  // Step 1: Run scene analysis pipeline (subtitle -> chapters -> boundaries -> analysis)
  const pipelineResult = await runSceneAnalysisPipeline({
    videoId: video.videoId,
    assetId: String(video.videoId),
    muxAssetId: video.muxAssetId,
    subtitleUrl: video.subtitleUrl,
    videoLabel: video.label ?? "unknown",
  })

  // Step 2: Read back scene analysis artifact
  const artifactBytes = await readArtifact(
    String(video.videoId),
    "scene-analysis",
    "json",
  )
  const analysisResult = JSON.parse(
    new TextDecoder().decode(artifactBytes),
  ) as SceneAnalysisResult

  if (analysisResult.scenes.length === 0) {
    return {
      videoId: video.videoId,
      sceneCount: 0,
      totalInputTokens: pipelineResult.totalInputTokens,
      totalOutputTokens: pipelineResult.totalOutputTokens,
      embeddingTokens: 0,
      durationMs: Date.now() - start,
    }
  }
  const syncReport = await syncSceneAnalysisEmbeddings({
    assetId: String(video.videoId),
    videoId: video.videoId,
    coreId: video.coreId,
    muxAssetId: video.muxAssetId,
    playbackId: video.playbackId,
    language: video.subtitleLanguage,
    analysisResult,
  })

  if (syncReport.status === "failed" || syncReport.status === "unsupported") {
    throw new Error(
      `Scene embedding sync failed for video ${video.videoId} (${video.title}): ${
        syncReport.reason ?? syncReport.status
      }`,
    )
  }

  return {
    videoId: video.videoId,
    sceneCount: syncReport.indexedSceneCount ?? 0,
    totalInputTokens: pipelineResult.totalInputTokens,
    totalOutputTokens: pipelineResult.totalOutputTokens,
    embeddingTokens: syncReport.embeddingTokens ?? 0,
    durationMs: Date.now() - start,
  }
}
