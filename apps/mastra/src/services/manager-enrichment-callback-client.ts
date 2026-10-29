import { z } from "zod"
import {
  CallbackStepDetailsSchema,
  CallbackReportsSchema,
  CALLBACK_MAX_ARTIFACTS,
  CALLBACK_MAX_LANGUAGES,
  CALLBACK_BODY_MAX_BYTES,
} from "./manager-enrichment-callback-contract"

import { env } from "../config/env"

export const FORGE_WORKFLOW_STEPS = [
  "audio_cleanup",
  "transcription",
  "structured_transcript",
  "translation",
  "chapters",
  "metadata",
  "embeddings",
  "mux_upload",
  "theology_validation_bible_quotes",
  "seo_improvements",
] as const

const CALLBACK_ID_MAX_LENGTH = 128
const CALLBACK_ERROR_MAX_LENGTH = 2_000
const CALLBACK_ARTIFACT_KEY_MAX_LENGTH = 128
const CALLBACK_LANGUAGE_RESULTS_MAX = CALLBACK_MAX_LANGUAGES

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
      .max(CALLBACK_MAX_ARTIFACTS)
      .optional(),
    details: CallbackStepDetailsSchema.optional(),
    reports: CallbackReportsSchema.optional(),
    languageResults: z
      .array(translationLanguageResultSchema)
      .max(CALLBACK_LANGUAGE_RESULTS_MAX)
      .refine(
        (results) =>
          new Set(results.map((result) => result.lang.toLowerCase())).size ===
          results.length,
        "Duplicate languages",
      )
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
        | "ownership_lost"
        | "invalid_response"
      status?: number
      message?: string
    }

type CallbackClientOptions = {
  callbackUrl?: string
  bearer?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  /** Entire delivery budget, including Retry-After waits. */
  retryBudgetMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
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

async function readCallbackAcknowledgement(
  response: Response,
): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) return undefined
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 4096) {
        await reader.cancel().catch(() => {})
        return undefined
      }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString()) as unknown
  } catch {
    return undefined
  }
}
const callbackAcknowledgement = z.discriminatedUnion("action", [
  z.object({ ok: z.literal(true), action: z.literal("applied") }).strict(),
  z
    .object({
      ok: z.literal(true),
      action: z.literal("dropped"),
      reason: z.string().max(128),
    })
    .strict(),
])

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

  const body = JSON.stringify(parsed.data)
  if (Buffer.byteLength(body) > CALLBACK_BODY_MAX_BYTES)
    return {
      ok: false,
      reason: "invalid_payload",
      message: "Callback exceeds 64 KiB",
    }
  const now = options.now ?? Date.now
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline =
    now() + Math.min(Math.max(options.retryBudgetMs ?? 90_000, 1), 90_000)
  for (let attempt = 0; attempt < 4; attempt++) {
    const remaining = deadline - now()
    if (remaining <= 0)
      return {
        ok: false,
        reason: "network_error",
        message: "Callback delivery deadline exceeded",
      }
    let response: Response
    try {
      response = await fetchImpl(callbackUrl, {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)),
      })
    } catch {
      // Outcome may be ambiguous, but replaying the exact run/step/sequence is safe.
      if (attempt === 3) return { ok: false, reason: "network_error" }
      const delay = 250 * 2 ** attempt
      if (now() + delay >= deadline)
        return { ok: false, reason: "network_error" }
      await sleep(delay)
      continue
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {})
      return { ok: false, reason: "auth_failed", status: response.status }
    }
    if (response.ok) {
      const acknowledgement = callbackAcknowledgement.safeParse(
        await readCallbackAcknowledgement(response),
      )
      if (!acknowledgement.success)
        return {
          ok: false,
          reason: "invalid_response",
          status: response.status,
        }
      if (
        acknowledgement.data.action === "dropped" &&
        acknowledgement.data.reason !== "stale_sequence"
      )
        return { ok: false, reason: "ownership_lost", status: response.status }
      return { ok: true, status: response.status }
    }
    const retryAfter = response.headers.get("retry-after")
    const retryAfterMs =
      retryAfter == null
        ? NaN
        : /^\d+(?:\.\d+)?$/.test(retryAfter)
          ? Number(retryAfter) * 1_000
          : Date.parse(retryAfter) - now()
    const delay = Number.isFinite(retryAfterMs)
      ? Math.max(0, retryAfterMs)
      : 250 * 2 ** attempt
    await response.body?.cancel().catch(() => {})
    if (
      (response.status !== 429 && response.status !== 503) ||
      attempt === 3 ||
      now() + delay >= deadline
    ) {
      return { ok: false, reason: "rejected", status: response.status }
    }
    await sleep(delay)
  }
  return { ok: false, reason: "network_error" }
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
