import { z } from "zod"

import { env } from "@/config/env"
import { SHA256 } from "@/features/subtitle-lab/subtitle-lab-contract"

export const SUBTITLE_EVAL_MAX_RESPONSE_BYTES = 6 * 1024 * 1024
export const SUBTITLE_EVAL_MAX_PROVIDER_CALLS_PER_CELL = 64

const boundedId = z.string().min(1).max(191)
const trackSchema = z
  .object({
    role: z.enum(["source", "reference"]),
    language: z.string().min(2).max(35),
    coreLanguageId: boundedId,
    subtitleId: boundedId,
    videoId: boundedId,
    edition: boundedId,
    coreVideoEditionId: boundedId,
    cueCount: z.number().int().positive().max(1_000),
  })
  .strict()
const snapshotSchema = z
  .object({
    body: z
      .string()
      .min(1)
      .max(512 * 1024),
    sha256: SHA256,
    rawSha256: SHA256,
    clippedSha256: SHA256.optional(),
    byteLength: z
      .number()
      .int()
      .positive()
      .max(512 * 1024),
    mediaType: z.literal("text/vtt"),
    track: trackSchema,
  })
  .strict()

export const mastraSubtitleEvalRequestSchema = z
  .object({
    schemaVersion: z.literal("subtitle-translation-eval-cell-request/v1"),
    cellId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/),
    caseId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    manifestDigest: SHA256,
    lockDigest: SHA256,
    targetLanguage: z.string().min(2).max(35),
    provider: z.literal("openrouter"),
    model: z.string().min(1).max(160),
    promptPolicyId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    workflowPolicyDigest: SHA256,
    timeoutMs: z.number().int().min(60_000).max(600_000),
    concurrency: z.literal(1),
    source: snapshotSchema,
    reference: snapshotSchema,
  })
  .strict()

const usageOperation = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    providerResponseCount: z.number().int().nonnegative().nullable(),
    unaccountedResponseCount: z.number().int().nonnegative(),
    accounting: z.enum([
      "instrumented",
      "reported",
      "not_invoked",
      "partial",
      "unavailable",
    ]),
  })
  .strict()
const usageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    retimeFallbackCount: z.number().int().nonnegative(),
    operations: z
      .object({
        scriptureDetection: usageOperation,
        translation: usageOperation,
        retiming: usageOperation,
        scriptureValidation: usageOperation,
      })
      .strict(),
    coverage: z
      .object({
        status: z.enum(["complete", "partial"]),
        missingOperations: z.array(
          z.enum([
            "scripture_detection",
            "translation",
            "retiming",
            "scripture_validation",
          ]),
        ),
      })
      .strict(),
  })
  .strict()
const providerCallSchema = z
  .object({
    callSequence: z.number().int().positive().max(1_000),
    operation: z.enum([
      "scripture_detection",
      "translation",
      "retiming",
      "scripture_validation",
    ]),
    chunkIndex: z.number().int().nonnegative().max(1_000).nullable(),
    operationAttempt: z.number().int().nonnegative().max(10),
    status: z.enum(["SUCCEEDED", "FAILED", "INVALID_OUTPUT"]),
    requestDigest: SHA256,
    providerRequestId: boundedId.nullable(),
    providerResponseId: boundedId.nullable(),
    requestedModel: z.string().min(1).max(160),
    resolvedModel: z.string().min(1).max(160).nullable(),
    usage: z
      .object({
        promptTokens: z.number().int().nonnegative(),
        completionTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict()
export type MastraSubtitleEvalProviderCall = z.infer<typeof providerCallSchema>
const metricsSchema = z
  .object({
    structural: z
      .object({
        passed: z.boolean(),
        failures: z.array(z.string()).max(2_000),
        warnings: z.array(z.string()).max(2_000),
        sourceSpeechCoverage: z.number().finite(),
      })
      .strict(),
    text: z
      .object({
        characterNgramFScore: z.number().finite(),
        windowedCharacterNgramFScore: z.number().finite(),
        generatedCharacterCount: z.number().int().nonnegative(),
        referenceCharacterCount: z.number().int().nonnegative(),
        lengthRatio: z.number().finite().nullable(),
      })
      .strict(),
    timing: z
      .object({
        referenceOverlapPrecision: z.number().finite(),
        referenceOverlapRecall: z.number().finite(),
        boundaryMeanAbsoluteErrorSeconds: z.number().finite().nullable(),
      })
      .strict(),
    readability: z
      .object({
        cueCount: z.number().int().nonnegative(),
        charactersPerSecondP50: z.number().finite(),
        charactersPerSecondP95: z.number().finite(),
        charactersPerSecondMax: z.number().finite(),
        maximumLineLength: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()

const reviewCue = z
  .object({
    index: z.number().int().nonnegative(),
    start: z.number().finite().nonnegative(),
    end: z.number().finite().positive(),
    text: z.string().max(20_000),
  })
  .strict()
const reviewEvidenceSchema = z
  .object({
    schemaVersion: z.literal("subtitle-translation-review-evidence/v1"),
    alignment: z.literal("connected-time-overlap/v1"),
    diff: z.literal("intl-word-grapheme-safe/v1"),
    locale: z.string().min(2).max(35),
    segments: z
      .array(
        z
          .object({
            id: z.string().regex(/^segment-[0-9]{4}$/),
            start: z.number().finite().nonnegative(),
            end: z.number().finite().positive(),
            source: z.array(reviewCue).max(200),
            reference: z.array(reviewCue).max(200),
            candidate: z.array(reviewCue).max(200),
            lexicalDiff: z
              .array(
                z
                  .object({
                    kind: z.enum(["equal", "insert", "delete"]),
                    text: z.string().min(1).max(40_000),
                  })
                  .strict(),
              )
              .max(4_096),
            timing: z
              .object({
                referenceStart: z.number().nullable(),
                referenceEnd: z.number().nullable(),
                candidateStart: z.number().nullable(),
                candidateEnd: z.number().nullable(),
                startDeltaSeconds: z.number().nullable(),
                endDeltaSeconds: z.number().nullable(),
              })
              .strict(),
            flags: z.array(
              z.enum([
                "text_diff",
                "timing_diff",
                "reference_only",
                "candidate_only",
              ]),
            ),
          })
          .strict(),
      )
      .max(3_000),
  })
  .strict()

const successSchema = z
  .object({
    ok: z.literal(true),
    schemaVersion: z.literal("subtitle-translation-eval-cell-result/v1"),
    identityAttestation: z
      .object({
        cellId: boundedId,
        caseId: boundedId,
        manifestDigest: SHA256,
        lockDigest: SHA256,
        targetLanguage: z.string().min(2).max(35),
        sourceSha256: SHA256,
        referenceSha256: SHA256,
        sourceSubtitleId: boundedId,
        referenceSubtitleId: boundedId,
      })
      .strict(),
    provider: z
      .object({
        name: z.literal("openrouter"),
        requestedModel: z.string().min(1).max(160),
        resolvedModel: z.string().min(1).max(160).nullable(),
      })
      .strict(),
    providerCalls: z
      .array(providerCallSchema)
      .max(SUBTITLE_EVAL_MAX_PROVIDER_CALLS_PER_CELL),
    policy: z
      .object({
        promptPolicyId: boundedId,
        workflowPolicyDigest: SHA256,
        workflowPolicyFiles: z.array(z.string().min(1).max(240)).min(1).max(40),
      })
      .strict(),
    build: z.object({ codeRevision: boundedId, buildId: boundedId }).strict(),
    determinism: z
      .object({
        temperature: z.literal(0),
        providerSeed: z.null(),
        concurrency: z.literal(1),
      })
      .strict(),
    runtime: z
      .object({ timeoutMs: z.number().int(), concurrency: z.literal(1) })
      .strict(),
    usage: usageSchema,
    metrics: metricsSchema,
    reviewEvidence: reviewEvidenceSchema,
    artifacts: z
      .object({
        candidateVtt: z
          .object({
            sha256: SHA256,
            byteLength: z
              .number()
              .int()
              .nonnegative()
              .max(1024 * 1024),
            mediaType: z.literal("text/vtt"),
            body: z.string().max(1024 * 1024),
          })
          .strict(),
        reviewEvidence: z
          .object({
            sha256: SHA256,
            byteLength: z
              .number()
              .int()
              .nonnegative()
              .max(2 * 1024 * 1024),
            mediaType: z.literal("application/json"),
            body: z.string().max(2 * 1024 * 1024),
          })
          .strict(),
      })
      .strict(),
    reproducibilityLimits: z.array(z.string().min(1).max(160)).max(10),
  })
  .strict()
const failureSchema = z
  .object({
    ok: z.literal(false),
    cellId: boundedId.optional(),
    reason: z.enum([
      "invalid_input",
      "identity_mismatch",
      "unsupported_case",
      "unsupported_language",
      "unsupported_provider",
      "unsupported_model",
      "unsupported_prompt_policy",
      "unsupported_workflow_policy",
      "budget_exceeded",
      "payload_too_large",
      "provider_config_missing",
      "provider_auth_failed",
      "provider_failed",
      "provider_invalid_output",
      "scoring_failed",
      "serialization_failed",
      "execution_failed",
    ]),
    failureClass: z.enum(["deterministic", "retryable", "permanent"]),
    retryable: z.boolean(),
    message: z.string().min(1).max(200),
    providerCalls: z
      .array(providerCallSchema)
      .max(SUBTITLE_EVAL_MAX_PROVIDER_CALLS_PER_CELL),
  })
  .strict()

export const mastraSubtitleEvalResultSchema = z.discriminatedUnion("ok", [
  successSchema,
  failureSchema,
])
export type MastraSubtitleEvalRequest = z.infer<
  typeof mastraSubtitleEvalRequestSchema
>
export type MastraSubtitleEvalResult = z.infer<
  typeof mastraSubtitleEvalResultSchema
>

export async function launchMastraSubtitleEvalCell(
  input: MastraSubtitleEvalRequest,
  options: {
    baseUrl?: string
    bearer?: string
    fetchImpl?: typeof fetch
  } = {},
): Promise<MastraSubtitleEvalResult> {
  const payload = mastraSubtitleEvalRequestSchema.parse(input)
  const baseUrl = options.baseUrl ?? env.MASTRA_BASE_URL
  const bearer = options.bearer ?? env.MASTRA_SERVICE_API_KEY
  if (!baseUrl || !bearer) {
    return fixedFailure("provider_config_missing", "permanent", false)
  }
  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(
      new URL("/forge-subtitle-translation-eval", baseUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(payload.timeoutMs + 10_000),
      },
    )
  } catch {
    return fixedFailure("execution_failed", "retryable", true, payload.cellId)
  }
  if (response.status === 401) {
    return fixedFailure(
      "provider_auth_failed",
      "permanent",
      false,
      payload.cellId,
    )
  }
  const raw = await readBoundedJson(
    response,
    SUBTITLE_EVAL_MAX_RESPONSE_BYTES,
  ).catch(() => undefined)
  const parsed = z
    .object({ result: mastraSubtitleEvalResultSchema })
    .strict()
    .safeParse(raw)
  if (!parsed.success) {
    return fixedFailure("execution_failed", "retryable", true, payload.cellId)
  }
  if (!response.ok && parsed.data.result.ok) {
    return fixedFailure("execution_failed", "permanent", false, payload.cellId)
  }
  return parsed.data.result
}

export async function readBoundedJson(
  response: Response,
  maximumBytes: number,
) {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(
      "Mastra subtitle evaluation response exceeded its byte ceiling.",
    )
  }
  if (!response.body)
    throw new Error("Mastra subtitle evaluation response was empty.")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    byteLength += value.byteLength
    if (byteLength > maximumBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error(
        "Mastra subtitle evaluation response exceeded its byte ceiling.",
      )
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

function fixedFailure(
  reason: z.infer<typeof failureSchema>["reason"],
  failureClass: z.infer<typeof failureSchema>["failureClass"],
  retryable: boolean,
  cellId?: string,
): z.infer<typeof failureSchema> {
  return failureSchema.parse({
    ok: false,
    ...(cellId ? { cellId } : {}),
    reason,
    failureClass,
    retryable,
    message: "Subtitle evaluation execution is unavailable.",
    providerCalls: [],
  })
}
