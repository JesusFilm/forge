import { z } from "zod"

import { env } from "../config/env"

export const FORGE_WORKFLOW_STEPS = [
  "transcription",
  "translation",
  "chapters",
  "metadata",
  "embeddings",
  "mux_upload",
  "audio_cleanup",
  "theology_validation_bible_quotes",
  "seo_improvements",
] as const

const CALLBACK_ID_MAX_LENGTH = 128
const CALLBACK_ERROR_MAX_LENGTH = 2_000
const CALLBACK_ARTIFACT_KEY_MAX_LENGTH = 128
const CALLBACK_LANGUAGE_RESULTS_MAX = 500

const translationLanguageResultSchema = z
  .object({
    lang: z.string().min(1).max(32),
    status: z.enum(["completed", "failed"]),
    error: z.string().max(CALLBACK_ERROR_MAX_LENGTH).optional(),
  })
  .strict()

const callbackBaseSchema = z
  .object({
    jobId: z.string().min(1).max(CALLBACK_ID_MAX_LENGTH),
    engine: z.literal("mastra"),
    runId: z.string().min(1).max(CALLBACK_ID_MAX_LENGTH),
    sequence: z.number().int().nonnegative(),
    step: z.enum(FORGE_WORKFLOW_STEPS),
    jobStatus: z.enum(["completed", "failed"]).optional(),
  })
  .strict()

const callbackArtifactsSchema = z
  .object({
    artifactsDelta: z
      .array(z.string().min(1).max(CALLBACK_ARTIFACT_KEY_MAX_LENGTH))
      .max(100)
      .optional(),
    languageResults: z
      .array(translationLanguageResultSchema)
      .max(CALLBACK_LANGUAGE_RESULTS_MAX)
      .optional(),
  })
  .strict()

export const ManagerEnrichmentCallbackSchema = z.discriminatedUnion("status", [
  callbackBaseSchema.extend({
    status: z.literal("running"),
  }),
  callbackBaseSchema.extend({
    status: z.literal("completed"),
    ...callbackArtifactsSchema.shape,
  }),
  callbackBaseSchema.extend({
    status: z.literal("failed"),
    error: z.string().min(1).max(CALLBACK_ERROR_MAX_LENGTH),
    ...callbackArtifactsSchema.shape,
  }),
  callbackBaseSchema.extend({
    status: z.literal("skipped"),
  }),
])

export type ManagerEnrichmentCallback = z.infer<
  typeof ManagerEnrichmentCallbackSchema
>

export type ManagerEnrichmentCallbackPostResult =
  | { ok: true; status: number }
  | {
      ok: false
      reason:
        | "config_missing"
        | "invalid_payload"
        | "auth_failed"
        | "network_error"
        | "rejected"
      status?: number
      message?: string
    }

type CallbackClientOptions = {
  callbackUrl?: string
  bearer?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

type ManagerCallbackConfig = {
  MANAGER_ENRICHMENT_CALLBACK_URL?: string
  MANAGER_ENRICHMENT_CALLBACK_API_KEY?: string
}

export class ManagerEnrichmentCallbackError extends Error {
  constructor(
    readonly result: Exclude<ManagerEnrichmentCallbackPostResult, { ok: true }>,
  ) {
    const status = result.status ? ` status=${result.status}` : ""
    const detail = result.message ? ` message=${result.message}` : ""
    super(
      `manager enrichment callback failed reason=${result.reason}${status}${detail}`,
    )
    this.name = "ManagerEnrichmentCallbackError"
  }
}

function formatValidationMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>"
      return `${path}: ${issue.message}`
    })
    .join("; ")
}

export function isManagerEnrichmentCallbackConfigured(
  config: ManagerCallbackConfig = env,
): boolean {
  return Boolean(
    config.MANAGER_ENRICHMENT_CALLBACK_URL &&
    config.MANAGER_ENRICHMENT_CALLBACK_API_KEY,
  )
}

export async function postManagerEnrichmentCallback(
  callback: unknown,
  options: CallbackClientOptions = {},
): Promise<ManagerEnrichmentCallbackPostResult> {
  const parsed = ManagerEnrichmentCallbackSchema.safeParse(callback)
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_payload",
      message: formatValidationMessage(parsed.error),
    }
  }

  const callbackUrl = options.callbackUrl ?? env.MANAGER_ENRICHMENT_CALLBACK_URL
  const bearer = options.bearer ?? env.MANAGER_ENRICHMENT_CALLBACK_API_KEY
  const timeoutMs =
    options.timeoutMs ?? env.MANAGER_ENRICHMENT_CALLBACK_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch

  if (!callbackUrl || !bearer) {
    return { ok: false, reason: "config_missing" }
  }

  let response: Response
  try {
    response = await fetchImpl(callbackUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    return {
      ok: false,
      reason: "network_error",
      message: error instanceof Error ? error.message : undefined,
    }
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: "auth_failed", status: response.status }
  }

  if (!response.ok) {
    const message = await response
      .text()
      .then((text) => text.slice(0, 500) || undefined)
      .catch(() => undefined)
    return {
      ok: false,
      reason: "rejected",
      status: response.status,
      message,
    }
  }

  return { ok: true, status: response.status }
}

export async function sendManagerEnrichmentCallback(
  callback: ManagerEnrichmentCallback,
  options: CallbackClientOptions = {},
): Promise<void> {
  const result = await postManagerEnrichmentCallback(callback, options)
  if (!result.ok) {
    throw new ManagerEnrichmentCallbackError(result)
  }
}
