import type {
  SceneAnalysis,
  SceneAnalysisResult,
} from "@/services/sceneAnalysis"
import { readArtifact } from "@/services/storage"
import type { SceneEmbeddingSyncReport } from "@/types/job"

export type SyncSceneAnalysisInput = {
  assetId: string
  videoId?: number
  videoDocumentId?: string
  coreId?: string | null
  muxAssetId: string
  playbackId?: string
  language?: string
  analysisResult?: SceneAnalysisResult
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  )
}

function normalizeSceneAnalysis(value: unknown): SceneAnalysis | undefined {
  if (!isRecord(value)) return undefined

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
  if (!isRecord(value) || !Array.isArray(value.scenes)) return undefined

  const scenes = value.scenes.map((scene) => normalizeSceneAnalysis(scene))
  if (scenes.some((scene) => scene == null)) return undefined

  return {
    scenes: scenes as SceneAnalysis[],
    totalInputTokens:
      typeof value.totalInputTokens === "number" &&
      Number.isFinite(value.totalInputTokens)
        ? value.totalInputTokens
        : 0,
    totalOutputTokens:
      typeof value.totalOutputTokens === "number" &&
      Number.isFinite(value.totalOutputTokens)
        ? value.totalOutputTokens
        : 0,
  }
}

async function loadSceneAnalysisResult(
  input: SyncSceneAnalysisInput,
): Promise<
  { ok: true; result: SceneAnalysisResult } | { ok: false; reason: string }
> {
  if (input.analysisResult) return { ok: true, result: input.analysisResult }

  try {
    const bytes = await readArtifact(input.assetId, "scene-analysis", "json")
    const parsed = normalizeSceneAnalysisResult(
      JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    )
    if (!parsed) return { ok: false, reason: "artifact_invalid" }
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

function buildReport(options: {
  status: SceneEmbeddingSyncReport["status"]
  generatedSceneCount: number
  indexableSceneCount: number
  skippedEmptySceneIndexes?: number[]
  reason?: string
}): SceneEmbeddingSyncReport {
  return {
    domain: "scene_embeddings",
    status: options.status,
    generatedSceneCount: options.generatedSceneCount,
    indexableSceneCount: options.indexableSceneCount,
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.skippedEmptySceneIndexes &&
    options.skippedEmptySceneIndexes.length > 0
      ? { skippedEmptySceneIndexes: options.skippedEmptySceneIndexes }
      : {}),
  }
}

export async function syncSceneAnalysisEmbeddings(
  input: SyncSceneAnalysisInput,
): Promise<SceneEmbeddingSyncReport> {
  const analysis = await loadSceneAnalysisResult(input)
  if (!analysis.ok) {
    return buildReport({
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
  const indexableSceneCount =
    generatedSceneCount - skippedEmptySceneIndexes.length

  if (indexableSceneCount === 0) {
    return buildReport({
      status: "skipped_empty",
      generatedSceneCount,
      indexableSceneCount,
      skippedEmptySceneIndexes,
    })
  }

  return buildReport({
    status: "source_ready",
    generatedSceneCount,
    indexableSceneCount,
    skippedEmptySceneIndexes,
  })
}
