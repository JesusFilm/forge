import { CmsHttpError, cmsPost } from "@/services/cmsClient"
import { EMBEDDING_MODEL, requestEmbeddingVectors } from "@/services/embeddings"
import type {
  SceneAnalysis,
  SceneAnalysisResult,
} from "@/services/sceneAnalysis"
import { readArtifact } from "@/services/storage"
import type { SceneEmbeddingSyncReport } from "@/types/job"

type SceneEmbeddingIndexSceneInput = {
  videoId?: number
  coreId?: string
  muxAssetId: string
  playbackId: string
  sceneIndex: number
  startSeconds: number
  endSeconds?: number
  description: string
  themes?: string[]
  bibleVerses?: string[]
  demographics?: string[]
  spiritualContext?: string[]
  chapterTitle?: string
  embedding: number[]
  model?: string
  language?: string
}

type CmsSceneIndexResponse = {
  scenesIndexed: number
  resolvedVideoId: number
  videoDocumentId?: string
}

export type SyncSceneAnalysisInput = {
  assetId: string
  videoId?: number
  videoDocumentId?: string
  coreId?: string | null
  muxAssetId: string
  playbackId: string
  language?: string
  analysisResult?: SceneAnalysisResult
}

const MAX_EMBED_RETRIES = 3
const MAX_INDEX_RETRIES = 3
const INDEX_CHUNK_SIZE = 20

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  )
}

function normalizeSceneAnalysis(value: unknown): SceneAnalysis | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  if (
    typeof value.sceneIndex !== "number" ||
    !Number.isFinite(value.sceneIndex) ||
    typeof value.startSeconds !== "number" ||
    !Number.isFinite(value.startSeconds) ||
    (value.endSeconds != null &&
      (typeof value.endSeconds !== "number" ||
        !Number.isFinite(value.endSeconds))) ||
    (value.chapterTitle != null && typeof value.chapterTitle !== "string") ||
    typeof value.description !== "string" ||
    !isStringArray(value.themes) ||
    !isStringArray(value.bibleVerses) ||
    !isStringArray(value.demographics) ||
    !isStringArray(value.spiritualContext)
  ) {
    return undefined
  }

  return {
    sceneIndex: value.sceneIndex,
    startSeconds: value.startSeconds,
    endSeconds: value.endSeconds ?? null,
    chapterTitle: value.chapterTitle ?? null,
    description: value.description,
    themes: value.themes,
    bibleVerses: value.bibleVerses,
    demographics: value.demographics,
    spiritualContext: value.spiritualContext,
  }
}

function normalizeSceneAnalysisResult(
  value: unknown,
): SceneAnalysisResult | undefined {
  if (!isRecord(value) || !Array.isArray(value.scenes)) {
    return undefined
  }

  const scenes = value.scenes.map((scene) => normalizeSceneAnalysis(scene))
  if (scenes.some((scene) => scene == null)) {
    return undefined
  }

  const totalInputTokens =
    typeof value.totalInputTokens === "number" &&
    Number.isFinite(value.totalInputTokens)
      ? value.totalInputTokens
      : 0
  const totalOutputTokens =
    typeof value.totalOutputTokens === "number" &&
    Number.isFinite(value.totalOutputTokens)
      ? value.totalOutputTokens
      : 0

  return {
    scenes: scenes as SceneAnalysis[],
    totalInputTokens,
    totalOutputTokens,
  }
}

async function loadSceneAnalysisResult(
  input: SyncSceneAnalysisInput,
): Promise<
  { ok: true; result: SceneAnalysisResult } | { ok: false; reason: string }
> {
  if (input.analysisResult) {
    return { ok: true, result: input.analysisResult }
  }

  try {
    const bytes = await readArtifact(input.assetId, "scene-analysis", "json")
    const parsed = normalizeSceneAnalysisResult(
      JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    )
    if (!parsed) {
      return { ok: false, reason: "artifact_invalid" }
    }

    return { ok: true, result: parsed }
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error &&
        /not found|missing|no such key|ENOENT/i.test(error.message)
          ? "artifact_missing"
          : "artifact_invalid",
    }
  }
}

function readCmsErrorCode(error: CmsHttpError): string | undefined {
  if (
    isRecord(error.responseData) &&
    typeof error.responseData.error === "string"
  ) {
    return error.responseData.error
  }

  return undefined
}

function buildBaseReport(
  input: SyncSceneAnalysisInput,
  options: {
    status: SceneEmbeddingSyncReport["status"]
    generatedSceneCount: number
    indexableSceneCount: number
    skippedEmptySceneIndexes?: number[]
    resolvedVideoId?: number
    reason?: string
    dimensions?: number
    embeddingTokens?: number
    indexedSceneCount?: number
  },
): SceneEmbeddingSyncReport {
  return {
    domain: "scene_embeddings",
    status: options.status,
    generatedSceneCount: options.generatedSceneCount,
    indexableSceneCount: options.indexableSceneCount,
    ...(input.videoDocumentId
      ? { videoDocumentId: input.videoDocumentId }
      : {}),
    ...(options.resolvedVideoId != null
      ? { resolvedVideoId: options.resolvedVideoId }
      : {}),
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.dimensions != null ? { dimensions: options.dimensions } : {}),
    ...(options.embeddingTokens != null
      ? { embeddingTokens: options.embeddingTokens }
      : {}),
    ...(options.indexedSceneCount != null
      ? { indexedSceneCount: options.indexedSceneCount }
      : {}),
    ...(options.skippedEmptySceneIndexes &&
    options.skippedEmptySceneIndexes.length > 0
      ? { skippedEmptySceneIndexes: options.skippedEmptySceneIndexes }
      : {}),
    ...(options.status === "indexed"
      ? { model: EMBEDDING_MODEL.replace("openai/", "") }
      : {}),
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function generateSceneEmbeddings(descriptions: string[]): Promise<{
  embeddings: number[][]
  dimensions: number
  embeddingTokens: number
}> {
  const attemptErrors: string[] = []

  for (let attempt = 1; attempt <= MAX_EMBED_RETRIES; attempt += 1) {
    try {
      const response = await requestEmbeddingVectors(descriptions, {
        expectedDimensions: null,
        context: `Scene embedding batch ${attempt}/${MAX_EMBED_RETRIES}`,
        itemLabel: "scene descriptions",
      })

      return {
        embeddings: response.embeddings,
        dimensions: response.dimensions,
        embeddingTokens: response.tokenCount,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      attemptErrors.push(`attempt ${attempt}: ${message}`)

      console.warn(
        JSON.stringify({
          event: "scene_embedding_retry",
          attempt,
          reason: message,
          sceneCount: descriptions.length,
        }),
      )

      if (attempt < MAX_EMBED_RETRIES) {
        await sleep(3000 * attempt)
      }
    }
  }

  console.warn(
    JSON.stringify({
      event: "scene_embedding_batch_failed_falling_back_to_single",
      sceneCount: descriptions.length,
      attempts: attemptErrors,
    }),
  )

  const embeddings: number[][] = []
  let dimensions: number | null = null
  let embeddingTokens = 0

  for (let index = 0; index < descriptions.length; index += 1) {
    if (index > 0) {
      await sleep(500)
    }

    const response = await requestEmbeddingVectors([descriptions[index]!], {
      expectedDimensions: dimensions,
      context: `Scene embedding ${index + 1}/${descriptions.length}`,
      itemLabel: "scene descriptions",
    })

    dimensions = response.dimensions
    embeddingTokens += response.tokenCount
    embeddings.push(response.embeddings[0]!)
  }

  if (dimensions == null) {
    throw new Error("scene_embedding_missing_dimensions")
  }

  return { embeddings, dimensions, embeddingTokens }
}

function buildSceneRows(
  input: SyncSceneAnalysisInput,
  scenes: SceneAnalysis[],
  embeddings: number[][],
): SceneEmbeddingIndexSceneInput[] {
  return scenes.map((scene, index) => ({
    coreId: input.coreId ?? undefined,
    muxAssetId: input.muxAssetId,
    playbackId: input.playbackId,
    sceneIndex: scene.sceneIndex,
    startSeconds: scene.startSeconds,
    endSeconds: scene.endSeconds ?? undefined,
    description: scene.description,
    themes: scene.themes,
    bibleVerses: scene.bibleVerses,
    demographics: scene.demographics,
    spiritualContext: scene.spiritualContext,
    chapterTitle: scene.chapterTitle ?? undefined,
    embedding: embeddings[index]!,
    model: EMBEDDING_MODEL.replace("openai/", ""),
    language: input.language ?? "en",
  }))
}

export async function syncSceneAnalysisEmbeddings(
  input: SyncSceneAnalysisInput,
): Promise<SceneEmbeddingSyncReport> {
  const analysis = await loadSceneAnalysisResult(input)
  if (!analysis.ok) {
    return buildBaseReport(input, {
      status: "failed",
      reason: analysis.reason,
      generatedSceneCount: 0,
      indexableSceneCount: 0,
    })
  }

  const generatedSceneCount = analysis.result.scenes.length
  const skippedEmptySceneIndexes = analysis.result.scenes
    .filter((scene) => scene.description.trim().length === 0)
    .map((scene) => scene.sceneIndex)
  const indexableScenes = analysis.result.scenes.filter(
    (scene) => scene.description.trim().length > 0,
  )

  if (input.videoId == null && !input.videoDocumentId) {
    return buildBaseReport(input, {
      status: "unsupported",
      reason: "no_video_target",
      generatedSceneCount,
      indexableSceneCount: indexableScenes.length,
      skippedEmptySceneIndexes,
    })
  }

  if (indexableScenes.length === 0) {
    return buildBaseReport(input, {
      status: "skipped_empty",
      generatedSceneCount,
      indexableSceneCount: 0,
      skippedEmptySceneIndexes,
    })
  }

  let dimensions: number | undefined
  let embeddingTokens = 0

  try {
    const embeddingResult = await generateSceneEmbeddings(
      indexableScenes.map((scene) => scene.description),
    )
    dimensions = embeddingResult.dimensions
    embeddingTokens = embeddingResult.embeddingTokens

    const scenes = buildSceneRows(
      input,
      indexableScenes,
      embeddingResult.embeddings,
    )

    let resolvedVideoId: number | undefined
    let videoDocumentId = input.videoDocumentId
    let indexedSceneCount = 0

    for (let offset = 0; offset < scenes.length; offset += INDEX_CHUNK_SIZE) {
      const chunk = scenes.slice(offset, offset + INDEX_CHUNK_SIZE)
      const isFirstChunk = offset === 0

      for (let attempt = 1; attempt <= MAX_INDEX_RETRIES; attempt += 1) {
        try {
          const response = await cmsPost<CmsSceneIndexResponse>(
            "/scene-embedding/index",
            {
              ...(input.videoId != null ? { videoId: input.videoId } : {}),
              ...(videoDocumentId ? { videoDocumentId } : {}),
              scenes: chunk,
              ...(isFirstChunk ? {} : { skipDelete: true }),
            },
          )

          resolvedVideoId = response.resolvedVideoId
          videoDocumentId = response.videoDocumentId ?? videoDocumentId
          indexedSceneCount += response.scenesIndexed
          break
        } catch (error) {
          if (attempt === MAX_INDEX_RETRIES) {
            throw error
          }

          console.warn(
            JSON.stringify({
              event: "scene_embedding_index_retry",
              attempt,
              chunkStart: offset,
              chunkSize: chunk.length,
              error: error instanceof Error ? error.message : String(error),
            }),
          )

          await sleep(3000 * attempt)
        }
      }
    }

    return {
      ...buildBaseReport(input, {
        status: "indexed",
        generatedSceneCount,
        indexableSceneCount: indexableScenes.length,
        resolvedVideoId,
        skippedEmptySceneIndexes,
        dimensions,
        embeddingTokens,
        indexedSceneCount,
      }),
      ...(videoDocumentId ? { videoDocumentId } : {}),
    }
  } catch (error) {
    const reason =
      error instanceof CmsHttpError
        ? (readCmsErrorCode(error) ?? "cms_request_failed")
        : error instanceof Error
          ? error.message
          : "scene_embedding_failed"

    return buildBaseReport(input, {
      status: "failed",
      reason,
      generatedSceneCount,
      indexableSceneCount: indexableScenes.length,
      skippedEmptySceneIndexes,
      dimensions,
      embeddingTokens,
    })
  }
}
