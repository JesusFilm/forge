// Scene embedder — bridges scene analysis pipeline to CMS embedding indexer.
// Per-video: run pipeline -> embed descriptions -> POST to CMS indexer.

import { getOpenrouter } from "@/services/openrouter"
import { readArtifact } from "@/services/storage"
import { cmsPost } from "@/services/cmsClient"
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

  // Step 3: Generate embeddings for all scene descriptions in one batch
  const descriptions = analysisResult.scenes.map((s) => s.description)
  const embeddingResponse = await getOpenrouter().embeddings.create({
    model: "openai/text-embedding-3-small",
    input: descriptions,
  })

  if (embeddingResponse.data.length !== descriptions.length) {
    throw new Error(
      `Embedding count mismatch: expected ${descriptions.length}, got ${embeddingResponse.data.length}`,
    )
  }

  const embeddingTokens = embeddingResponse.usage?.total_tokens ?? 0

  // Step 4: Build SceneEmbeddingInput array and POST to CMS indexer
  const scenes = analysisResult.scenes.map((scene, i) => ({
    videoId: video.videoId,
    coreId: video.coreId ?? undefined,
    muxAssetId: video.muxAssetId,
    playbackId: video.playbackId,
    sceneIndex: scene.sceneIndex,
    startSeconds: scene.startSeconds,
    endSeconds: scene.endSeconds ?? undefined,
    description: scene.description,
    themes: scene.themes,
    bibleVerses: scene.bibleVerses,
    demographics: scene.demographics,
    chapterTitle: scene.chapterTitle ?? undefined,
    embedding: embeddingResponse.data[i]!.embedding,
    model: "text-embedding-3-small",
    language: video.subtitleLanguage,
  }))

  await cmsPost<{ scenesIndexed: number }>("/scene-embedding/index", {
    scenes,
  })

  return {
    videoId: video.videoId,
    sceneCount: analysisResult.scenes.length,
    totalInputTokens: pipelineResult.totalInputTokens,
    totalOutputTokens: pipelineResult.totalOutputTokens,
    embeddingTokens,
    durationMs: Date.now() - start,
  }
}
