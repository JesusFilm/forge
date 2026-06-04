import {
  asRecord,
  callAdminEmbeddingIngest,
  isAdminEmbeddingIngestStatus,
  type AdminEmbeddingIngestClientResult,
  type EmbeddingGenerationMode,
} from "./admin-embedding-ingest-client"

export type SceneEmbeddingGenerationMode = EmbeddingGenerationMode

export type AdminSceneEmbeddingIngestPayload = {
  target: {
    admin: {
      videoId: string
      videoEditionId: string
      coreId?: string
    }
  }
  locale: string
  source: {
    artifactKey: string
    artifactVersion: string
    provider: string
    generatedAt?: string
    contentHash: string
  }
  model: {
    name: string
    dimensions: number
    nativeDimensions?: number
    provider?: string
    transformVersion?: string
  }
  generation: {
    mode: SceneEmbeddingGenerationMode
    generatedAt: string
    mastraRunId: string
  }
  scenes: Array<{
    sceneIndex: number
    startSeconds: number
    endSeconds?: number
    chapterTitle?: string
    sourceText: string
    description: string
    themes?: string[]
    bibleVerses?: string[]
    demographics?: string[]
    spiritualContext?: string[]
    embedding: number[]
  }>
}

export type AdminSceneEmbeddingIngestResult = {
  status:
    | "created"
    | "unchanged"
    | "repaired"
    | "forced"
    | "model_upgraded"
    | "rejected"
  reason?: string
  target: {
    videoId: string
    videoEditionId: string
    coreId: string
    locale: string
  }
  scenes: number
  model: string
  dimensions: number
  mastraRunId: string
}

export type AdminSceneIngestClientResult =
  AdminEmbeddingIngestClientResult<AdminSceneEmbeddingIngestResult>

export type CallAdminSceneIngestInput = {
  ingestUrl?: string
  bearer?: string
  payload: AdminSceneEmbeddingIngestPayload
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function parseAdminResult(
  body: unknown,
): AdminSceneEmbeddingIngestResult | null {
  const record = asRecord(body)
  const result = asRecord(record?.result)
  if (!result) return null

  if (
    !isAdminEmbeddingIngestStatus(result.status) ||
    typeof result.scenes !== "number" ||
    typeof result.model !== "string" ||
    typeof result.dimensions !== "number" ||
    typeof result.mastraRunId !== "string"
  ) {
    return null
  }

  const target = asRecord(result.target)
  if (
    !target ||
    typeof target.videoId !== "string" ||
    typeof target.videoEditionId !== "string" ||
    typeof target.coreId !== "string" ||
    typeof target.locale !== "string"
  ) {
    return null
  }

  return {
    status: result.status,
    reason: typeof result.reason === "string" ? result.reason : undefined,
    target: {
      videoId: target.videoId,
      videoEditionId: target.videoEditionId,
      coreId: target.coreId,
      locale: target.locale,
    },
    scenes: result.scenes,
    model: result.model,
    dimensions: result.dimensions,
    mastraRunId: result.mastraRunId,
  }
}

export async function callAdminSceneIngest({
  ingestUrl,
  bearer,
  payload,
  timeoutMs = 30_000,
  fetchImpl = fetch,
}: CallAdminSceneIngestInput): Promise<AdminSceneIngestClientResult> {
  return callAdminEmbeddingIngest({
    ingestUrl,
    bearer,
    payload,
    parseResult: parseAdminResult,
    timeoutMs,
    fetchImpl,
  })
}
