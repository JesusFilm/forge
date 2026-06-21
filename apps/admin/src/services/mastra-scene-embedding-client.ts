import { env } from "@/config/env"
import { resolveMastraLaunchTimeoutMs } from "@/services/mastra-launch-timeout"
import {
  sceneAnalysisArtifactKey,
  type SceneAnalysisResult,
} from "@/services/manager-artifacts.service"

export type MastraSceneEmbeddingMode =
  | "idempotent"
  | "repair"
  | "force"
  | "model-upgrade"

export type MastraSceneEmbeddingTarget = {
  videoId: string
  videoEditionId: string
  coreId?: string
}

export type MastraSceneEmbeddingLaunchInput = {
  target: MastraSceneEmbeddingTarget
  locale: string
  assetId: number | string
  sceneAnalysis: SceneAnalysisResult
  sourceArtifactLocale?: string | null
  mode?: MastraSceneEmbeddingMode
}

export type MastraSceneEmbeddingLaunchResult =
  | {
      ok: true
      status: "created" | "unchanged" | "repaired" | "forced" | "model_upgraded"
      scenes: number
      providerTokens: number
      model: string
      provider: string
      dimensions: number
      mastraRunId: string
      sourceContentHash: string
    }
  | {
      ok: false
      reason:
        | "config_missing"
        | "auth_failed"
        | "network_error"
        | "parse_error"
        | "invalid_input"
        | "provider_config_missing"
        | "provider_auth_failed"
        | "provider_failed"
        | "provider_dimension_mismatch"
        | "admin_config_missing"
        | "admin_auth_failed"
        | "admin_ingest_rejected"
        | "admin_ingest_failed"
      retryable: boolean
      mastraRunId?: string
      adminStatus?: string
      adminReason?: string
    }

export type LaunchMastraSceneEmbeddingOptions = {
  baseUrl?: string
  bearer?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const SUCCESS_STATUSES = new Set([
  "created",
  "unchanged",
  "repaired",
  "forced",
  "model_upgraded",
])

const FAILURE_REASONS = new Set([
  "config_missing",
  "auth_failed",
  "network_error",
  "parse_error",
  "invalid_input",
  "provider_config_missing",
  "provider_auth_failed",
  "provider_failed",
  "provider_dimension_mismatch",
  "admin_config_missing",
  "admin_auth_failed",
  "admin_ingest_rejected",
  "admin_ingest_failed",
])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function parseWorkflowResult(
  value: unknown,
): MastraSceneEmbeddingLaunchResult | null {
  const record = asRecord(value)
  const result = asRecord(record?.result)
  if (!result || typeof result.ok !== "boolean") return null

  if (result.ok === true) {
    if (
      typeof result.status !== "string" ||
      !SUCCESS_STATUSES.has(result.status) ||
      typeof result.scenes !== "number" ||
      typeof result.providerTokens !== "number" ||
      typeof result.model !== "string" ||
      typeof result.provider !== "string" ||
      typeof result.dimensions !== "number" ||
      typeof result.mastraRunId !== "string" ||
      typeof result.sourceContentHash !== "string"
    ) {
      return null
    }
    return {
      ok: true,
      status: result.status as Extract<
        MastraSceneEmbeddingLaunchResult,
        { ok: true }
      >["status"],
      scenes: result.scenes,
      providerTokens: result.providerTokens,
      model: result.model,
      provider: result.provider,
      dimensions: result.dimensions,
      mastraRunId: result.mastraRunId,
      sourceContentHash: result.sourceContentHash,
    }
  }

  if (
    typeof result.reason !== "string" ||
    !FAILURE_REASONS.has(result.reason) ||
    typeof result.retryable !== "boolean"
  ) {
    return null
  }

  return {
    ok: false,
    reason: result.reason as Extract<
      MastraSceneEmbeddingLaunchResult,
      { ok: false }
    >["reason"],
    retryable: result.retryable,
    mastraRunId:
      typeof result.mastraRunId === "string" ? result.mastraRunId : undefined,
    adminStatus:
      typeof result.adminStatus === "string" ? result.adminStatus : undefined,
    adminReason:
      typeof result.adminReason === "string" ? result.adminReason : undefined,
  }
}

function normalizeScenes(sceneAnalysis: SceneAnalysisResult) {
  return sceneAnalysis.scenes.map((scene) => ({
    sceneIndex: scene.sceneIndex,
    startSeconds: scene.startSeconds,
    ...(scene.endSeconds == null ? {} : { endSeconds: scene.endSeconds }),
    ...(scene.chapterTitle == null ? {} : { chapterTitle: scene.chapterTitle }),
    description: scene.description,
    themes: scene.themes,
    bibleVerses: scene.bibleVerses,
    demographics: scene.demographics,
    spiritualContext: scene.spiritualContext,
  }))
}

export async function launchMastraSceneEmbedding(
  input: MastraSceneEmbeddingLaunchInput,
  options: LaunchMastraSceneEmbeddingOptions = {},
): Promise<MastraSceneEmbeddingLaunchResult> {
  const baseUrl = options.baseUrl ?? env.MASTRA_BASE_URL
  const bearer = options.bearer ?? env.MASTRA_SERVICE_API_KEY
  if (!baseUrl || !bearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  const body = {
    target: {
      admin: input.target,
    },
    locale: input.locale,
    sceneAnalysis: {
      scenes: normalizeScenes(input.sceneAnalysis),
      artifactKey:
        input.sceneAnalysis.provenance?.artifactKey ??
        sceneAnalysisArtifactKey(input.assetId, input.sourceArtifactLocale),
      artifactVersion: "manager-scene-analysis-v1",
      provider: "manager",
      generatedAt: input.sceneAnalysis.provenance?.generatedAt,
    },
    mode: input.mode ?? "idempotent",
  }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(
      new URL("/forge-scene-embeddings", baseUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(
          resolveMastraLaunchTimeoutMs(
            options.timeoutMs ?? env.MASTRA_SCENE_EMBEDDING_TIMEOUT_MS,
          ),
        ),
      },
    )
  } catch {
    return { ok: false, reason: "network_error", retryable: true }
  }

  if (response.status === 401) {
    return { ok: false, reason: "auth_failed", retryable: false }
  }

  const result = parseWorkflowResult(
    await response.json().catch(() => undefined),
  )
  if (result) return result

  if (!response.ok) {
    return {
      ok: false,
      reason: "network_error",
      retryable: response.status >= 500 || response.status === 429,
    }
  }

  return { ok: false, reason: "parse_error", retryable: true }
}

export const _internals = {
  parseWorkflowResult,
}
