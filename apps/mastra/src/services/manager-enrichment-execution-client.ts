import { env } from "../config/env"
import { executionDigest } from "../server/enrichment-input-digest"
import type { TranscriptScriptureCorrectionResult } from "./subtitle-enrichment/transcript-correction-types"
import {
  enrichmentSourceReuse,
  type ForgeVideoEnrichmentInput,
} from "../server/forge-video-enrichment-contract"

export class ManagerEnrichmentExecutionError extends Error {
  constructor(readonly status: number) {
    super(`Manager execution bridge rejected operation: ${status}`)
    this.name = "ManagerEnrichmentExecutionError"
  }
}
export type MastraExecutionStage =
  | "source"
  | "correction"
  | "translation"
  | "chapters"
  | "metadata"
  | "embeddings"
  | "scene-analysis"
export type ManagerEnrichmentExecutionOperation =
  | {
      kind: "mastra-stage-claim"
      stage: MastraExecutionStage
      stageDigest: string
    }
  | {
      kind: "mastra-stage-complete"
      stage: MastraExecutionStage
      stageDigest: string
      claimToken: string
      result: { status: "completed" | "failed" }
    }
  | {
      kind: "run-admission"
      assetId: string
      muxAssetId: string
      sourceReuse: "none" | "transcript" | "subtitles"
    }
  | { kind: "audio-cleanup" }
  | {
      kind: "apply-transcript-corrections"
      correction: TranscriptScriptureCorrectionResult
    }
  | {
      kind: "mux-publication"
      languageResults: {
        lang: string
        status: "completed" | "failed"
        error?: string
      }[]
    }
export async function executeManagerEnrichmentOperation(
  input: {
    jobId: string
    runId: string
    inputDigest: string
    operation: ManagerEnrichmentExecutionOperation
  },
  options: {
    fetchImpl?: typeof fetch
    callbackUrl?: string
    bearer?: string
    timeoutMs?: number
  } = {},
): Promise<unknown> {
  const callbackUrl = options.callbackUrl ?? env.MANAGER_ENRICHMENT_CALLBACK_URL
  const bearer = options.bearer ?? env.MANAGER_ENRICHMENT_CALLBACK_API_KEY
  if (!callbackUrl || !bearer) throw new ManagerEnrichmentExecutionError(503)
  const body = JSON.stringify(input)
  if (Buffer.byteLength(body) > 64 * 1024)
    throw new ManagerEnrichmentExecutionError(413)
  const response = await (options.fetchImpl ?? fetch)(
    new URL("/api/internal/enrichment-execution", callbackUrl),
    {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? 15 * 60_000),
    },
  )
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new ManagerEnrichmentExecutionError(response.status)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new ManagerEnrichmentExecutionError(502)
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 64 * 1024) {
      await reader.cancel()
      throw new ManagerEnrichmentExecutionError(502)
    }
    chunks.push(value)
  }
  const payload: unknown = JSON.parse(Buffer.concat(chunks).toString())
  if (
    !payload ||
    typeof payload !== "object" ||
    !("ok" in payload) ||
    payload.ok !== true ||
    !("result" in payload)
  )
    throw new ManagerEnrichmentExecutionError(502)
  return payload.result
}
export async function admitManagerEnrichmentRun(
  input: ForgeVideoEnrichmentInput,
  runId: string,
): Promise<void> {
  const result = await executeManagerEnrichmentOperation(
    {
      jobId: input.jobId,
      runId,
      inputDigest: executionDigest(input),
      operation: {
        kind: "run-admission",
        assetId: input.assetId,
        muxAssetId: input.muxAssetId,
        sourceReuse: enrichmentSourceReuse(input),
      },
    },
    { timeoutMs: 15_000 },
  )
  if (
    !result ||
    typeof result !== "object" ||
    !("admitted" in result) ||
    result.admitted !== true
  )
    throw new ManagerEnrichmentExecutionError(502)
}
