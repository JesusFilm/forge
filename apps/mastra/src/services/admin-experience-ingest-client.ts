import {
  asRecord,
  callAdminEmbeddingIngest,
  isAdminEmbeddingIngestStatus,
  type AdminEmbeddingIngestClientResult,
  type EmbeddingGenerationMode,
} from "./admin-embedding-ingest-client"

export type ExperienceEmbeddingGenerationMode = EmbeddingGenerationMode

export type AdminExperienceEmbeddingIngestPayload = {
  target: {
    experienceId: string
    experienceLocaleId: string
    locale: string
    slug?: string
  }
  source: {
    contentHash: string
    summary: string
  }
  model: {
    name: string
    dimensions: number
    nativeDimensions?: number
    provider?: string
    transformVersion?: string
  }
  generation: {
    mode: ExperienceEmbeddingGenerationMode
    generatedAt: string
    mastraRunId: string
  }
  embedding: number[]
}

export type AdminExperienceEmbeddingIngestResult = {
  status:
    | "created"
    | "unchanged"
    | "repaired"
    | "forced"
    | "model_upgraded"
    | "rejected"
  reason?: string
  target: {
    experienceId: string
    experienceLocaleId: string
    locale: string
  }
  model: string
  dimensions: number
  mastraRunId: string
}

export type AdminExperienceIngestClientResult =
  AdminEmbeddingIngestClientResult<AdminExperienceEmbeddingIngestResult>

export type CallAdminExperienceIngestInput = {
  ingestUrl?: string
  bearer?: string
  payload: AdminExperienceEmbeddingIngestPayload
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function parseAdminResult(
  body: unknown,
): AdminExperienceEmbeddingIngestResult | null {
  const record = asRecord(body)
  const result = asRecord(record?.result)
  if (!result) return null

  if (
    !isAdminEmbeddingIngestStatus(result.status) ||
    typeof result.model !== "string" ||
    typeof result.dimensions !== "number" ||
    typeof result.mastraRunId !== "string"
  ) {
    return null
  }

  const target = asRecord(result.target)
  if (
    !target ||
    typeof target.experienceId !== "string" ||
    typeof target.experienceLocaleId !== "string" ||
    typeof target.locale !== "string"
  ) {
    return null
  }

  return {
    status: result.status,
    reason: typeof result.reason === "string" ? result.reason : undefined,
    target: {
      experienceId: target.experienceId,
      experienceLocaleId: target.experienceLocaleId,
      locale: target.locale,
    },
    model: result.model,
    dimensions: result.dimensions,
    mastraRunId: result.mastraRunId,
  }
}

export async function callAdminExperienceIngest({
  ingestUrl,
  bearer,
  payload,
  timeoutMs = 30_000,
  fetchImpl = fetch,
}: CallAdminExperienceIngestInput): Promise<AdminExperienceIngestClientResult> {
  return callAdminEmbeddingIngest({
    ingestUrl,
    bearer,
    payload,
    parseResult: parseAdminResult,
    timeoutMs,
    fetchImpl,
  })
}
