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

  // Filter out scenes with empty descriptions — the embedding API rejects empty
  // strings (returns {error} instead of {data}). Empty descriptions mean the LLM
  // failed to extract any signals for that scene, so there's nothing to embed.
  const indexableScenes = analysisResult.scenes.filter(
    (s) => s.description.trim().length > 0,
  )

  if (indexableScenes.length === 0) {
    console.warn(
      JSON.stringify({
        event: "backfill_no_indexable_scenes",
        videoId: video.videoId,
        title: video.title,
        totalScenes: analysisResult.scenes.length,
      }),
    )
    return {
      videoId: video.videoId,
      sceneCount: 0,
      totalInputTokens: pipelineResult.totalInputTokens,
      totalOutputTokens: pipelineResult.totalOutputTokens,
      embeddingTokens: 0,
      durationMs: Date.now() - start,
    }
  }

  if (indexableScenes.length < analysisResult.scenes.length) {
    console.warn(
      JSON.stringify({
        event: "backfill_skipped_empty_scenes",
        videoId: video.videoId,
        title: video.title,
        totalScenes: analysisResult.scenes.length,
        indexableScenes: indexableScenes.length,
        skippedIndexes: analysisResult.scenes
          .filter((s) => s.description.trim().length === 0)
          .map((s) => s.sceneIndex),
      }),
    )
  }

  // Step 3: Generate embeddings for all scene descriptions in one batch.
  // OpenRouter occasionally returns a response without .data — retry up to 3 times.
  const descriptions = indexableScenes.map((s) => s.description)
  const MAX_EMBED_RETRIES = 3

  let embeddingResponse: Awaited<
    ReturnType<ReturnType<typeof getOpenrouter>["embeddings"]["create"]>
  > | null = null

  const attemptErrors: string[] = []

  for (let attempt = 1; attempt <= MAX_EMBED_RETRIES; attempt++) {
    try {
      const response = await getOpenrouter().embeddings.create({
        model: "openai/text-embedding-3-small",
        input: descriptions,
      })

      if (response.data?.length === descriptions.length) {
        embeddingResponse = response
        break
      }

      const detail = `attempt ${attempt}: malformed response (got ${response.data?.length ?? 0} embeddings, expected ${descriptions.length})`
      attemptErrors.push(detail)

      console.warn(
        JSON.stringify({
          event: "embedding_retry",
          videoId: video.videoId,
          title: video.title,
          attempt,
          reason: "malformed_response",
          expected: descriptions.length,
          got: response.data?.length ?? 0,
          rawKeys: response ? Object.keys(response) : [],
        }),
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const detail = `attempt ${attempt}: ${msg}`
      attemptErrors.push(detail)

      console.warn(
        JSON.stringify({
          event: "embedding_retry",
          videoId: video.videoId,
          title: video.title,
          attempt,
          reason: "thrown_error",
          error: msg,
          errorType: err instanceof Error ? err.constructor.name : typeof err,
        }),
      )
    }

    if (attempt < MAX_EMBED_RETRIES) {
      await new Promise((r) => setTimeout(r, 3000 * attempt))
    }
  }

  // Fallback: if batch embedding failed, try one-at-a-time
  if (!embeddingResponse) {
    console.warn(
      JSON.stringify({
        event: "embedding_batch_failed_falling_back_to_single",
        videoId: video.videoId,
        title: video.title,
        sceneCount: descriptions.length,
        batchAttempts: attemptErrors,
      }),
    )

    const singleEmbeddings: number[][] = []
    let singleTokens = 0

    for (let i = 0; i < descriptions.length; i++) {
      // Pace single-item calls to avoid hammering a rate-limited API
      if (i > 0) await new Promise((r) => setTimeout(r, 500))

      try {
        const singleResponse = await getOpenrouter().embeddings.create({
          model: "openai/text-embedding-3-small",
          input: [descriptions[i]!],
        })

        if (!singleResponse.data?.[0]?.embedding) {
          throw new Error(`Single-mode returned no embedding for scene ${i}`)
        }

        singleEmbeddings.push(singleResponse.data[0].embedding)
        singleTokens += singleResponse.usage?.total_tokens ?? 0
      } catch (err) {
        throw new Error(
          `Embedding failed for video ${video.videoId} (${video.title}), ` +
            `scene ${i}/${descriptions.length} in single mode: ` +
            `${err instanceof Error ? err.message : String(err)}. ` +
            `Batch attempts: [${attemptErrors.join(" | ")}]. ` +
            `Re-running the backfill will retry this video.`,
        )
      }
    }

    // Build a synthetic response matching the batch shape
    embeddingResponse = {
      data: singleEmbeddings.map((embedding, index) => ({
        embedding,
        index,
        object: "embedding" as const,
      })),
      model: "openai/text-embedding-3-small",
      object: "list" as const,
      usage: { prompt_tokens: singleTokens, total_tokens: singleTokens },
    }
  }

  const embeddingTokens = embeddingResponse.usage?.total_tokens ?? 0

  // Step 4: Build SceneEmbeddingInput array and POST to CMS indexer
  const scenes = indexableScenes.map((scene, i) => ({
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

  // Retry CMS POST to avoid losing computed embeddings on transient failures
  const MAX_INDEX_RETRIES = 3
  for (let attempt = 1; attempt <= MAX_INDEX_RETRIES; attempt++) {
    try {
      await cmsPost<{ scenesIndexed: number }>("/scene-embedding/index", {
        scenes,
      })
      break
    } catch (err) {
      if (attempt === MAX_INDEX_RETRIES) throw err
      console.warn(
        JSON.stringify({
          event: "index_retry",
          videoId: video.videoId,
          title: video.title,
          attempt,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      await new Promise((r) => setTimeout(r, 3000 * attempt))
    }
  }

  return {
    videoId: video.videoId,
    sceneCount: indexableScenes.length,
    totalInputTokens: pipelineResult.totalInputTokens,
    totalOutputTokens: pipelineResult.totalOutputTokens,
    embeddingTokens,
    durationMs: Date.now() - start,
  }
}
