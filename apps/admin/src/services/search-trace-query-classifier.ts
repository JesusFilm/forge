import type { PrismaClient } from "@prisma/client"
import { z } from "zod"

import { env } from "@/config/env"
import {
  SEARCH_TRACE_RULE_LABEL_VERSION,
  classifySearchTraceQuery,
  type SearchTraceAbuseLabel,
  type SearchTraceQueryQualityLabel,
  type SearchTraceSensitiveQueryLabel,
} from "@/services/search-trace-privacy"

const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions"

const DEFAULT_QUERY_CLASSIFIER_MODEL = "anthropic/claude-haiku-4-5"
const QUERY_CLASSIFIER_TIMEOUT_MS = 30_000
const MAX_PROMPT_QUERY_LENGTH = 512
const HIGH_IMPACT_RESULT_COUNT = 20
const OUTBOUND_SECRET_RE =
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|rk_live_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|basic\s+[A-Za-z0-9+/=]{12,}|bearer\s+[A-Za-z0-9._~+/=-]{10,}|(?:password|passwd|pwd|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|token)\s*(?::|=|\s+)\S+)/gi
const OUTBOUND_COOKIE_RE =
  /\b(?:cookie|set-cookie)\s*[:=]\s*[^;\s=]+=[^;\s]+|\b(?:session(?:id)?|session_id|sid|cf_clearance)\s*=\s*[^;\s]{6,}/gi
const OUTBOUND_USER_ID_RE =
  /\b(?:user[_-]?id|userid|uid|account[_-]?id|subject|sub)\s*(?::|=|\s+)[A-Za-z0-9][A-Za-z0-9._-]{5,}\b/gi
const IPV6_RE = /\b(?:[A-F0-9]{1,4}:){2,}[A-F0-9:]*[A-F0-9]{1,4}\b/gi

export const SEARCH_TRACE_LLM_LABEL_VERSION = "search-query-llm/v1"

const QueryQualitySchema = z.enum([
  "valid_viewer_intent",
  "empty_too_short",
  "navigational",
  "catalog_lookup",
  "malformed",
  "unknown_ambiguous",
])

const AbuseLabelSchema = z.enum([
  "none",
  "repeated_spam",
  "abusive",
  "prompt_injection_like",
])

const ClassificationResponseSchema = z.object({
  queryQualityLabel: QueryQualitySchema,
  abuseLabel: AbuseLabelSchema,
  confidence: z.enum(["low", "medium", "high"]),
  reasonCode: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_:-]+$/),
})

export type SearchTraceQueryClassificationInput = {
  queryText: string
  locale: string
  resultCount: number
  outcome: "success" | "degraded" | "failed"
  traceClass: string
  queryQualityLabel: SearchTraceQueryQualityLabel
  sensitiveQueryLabel: SearchTraceSensitiveQueryLabel
  abuseLabel: SearchTraceAbuseLabel
}

export type SearchTraceQueryClassification = z.infer<
  typeof ClassificationResponseSchema
>

export class SearchTraceQueryClassifierError extends Error {
  constructor(
    readonly code:
      | "missing_credentials"
      | "not_allowed"
      | "request_failed"
      | "validation"
      | "timeout"
      | "transport",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "SearchTraceQueryClassifierError"
  }
}

export type SearchTraceQueryClassifierOptions = {
  fetchImpl?: typeof fetch
  apiKey?: string
  model?: string
  timeoutMs?: number
  allowSensitiveOrAbusive?: boolean
}

export type SearchTraceQueryClassifier = {
  classify: (
    input: SearchTraceQueryClassificationInput,
  ) => Promise<SearchTraceQueryClassification>
  readonly model: string
  readonly source: string
  readonly version: typeof SEARCH_TRACE_LLM_LABEL_VERSION
}

function scrubOutboundText(value: string): string {
  return value
    .replace(OUTBOUND_SECRET_RE, "[redacted-token]")
    .replace(OUTBOUND_COOKIE_RE, "[redacted-cookie]")
    .replace(OUTBOUND_USER_ID_RE, "[redacted-user-id]")
    .replace(IPV6_RE, "[redacted-ip]")
}

function hasPattern(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0
  const matched = pattern.test(value)
  pattern.lastIndex = 0
  return matched
}

function hasResidualSensitiveShape(value: string): boolean {
  return (
    hasPattern(OUTBOUND_SECRET_RE, value) ||
    hasPattern(OUTBOUND_COOKIE_RE, value) ||
    hasPattern(OUTBOUND_USER_ID_RE, value) ||
    hasPattern(IPV6_RE, value)
  )
}

export function sanitizeSearchTraceQueryForLlm(queryText: string): string {
  const sanitized = scrubOutboundText(
    classifySearchTraceQuery(queryText).queryText,
  ).slice(0, MAX_PROMPT_QUERY_LENGTH)
  if (hasResidualSensitiveShape(sanitized)) {
    throw new SearchTraceQueryClassifierError(
      "validation",
      "query classifier prompt still contained sensitive-looking text after redaction",
    )
  }
  return sanitized
}

function sanitizeDiagnosticText(value: string): string {
  return scrubOutboundText(classifySearchTraceQuery(value).queryText)
}

export function isLlmClassificationCandidate(
  input: SearchTraceQueryClassificationInput,
  options: { allowSensitiveOrAbusive?: boolean } = {},
): boolean {
  if (
    options.allowSensitiveOrAbusive !== true &&
    (input.sensitiveQueryLabel !== "none" || input.abuseLabel !== "none")
  ) {
    return false
  }
  return (
    input.queryQualityLabel === "unknown_ambiguous" ||
    input.resultCount >= HIGH_IMPACT_RESULT_COUNT
  )
}

export function createSearchTraceQueryClassifier(
  options: SearchTraceQueryClassifierOptions = {},
): SearchTraceQueryClassifier {
  const apiKey =
    options.apiKey ?? env.OPENROUTER_API_PAID_KEY ?? env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new SearchTraceQueryClassifierError(
      "missing_credentials",
      "OPENROUTER_API_PAID_KEY or OPENROUTER_API_KEY is required to classify search trace queries",
    )
  }
  const model =
    options.model ??
    env.OPENROUTER_QUERY_CLASSIFIER_MODEL ??
    DEFAULT_QUERY_CLASSIFIER_MODEL
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? QUERY_CLASSIFIER_TIMEOUT_MS
  const allowSensitiveOrAbusive = options.allowSensitiveOrAbusive === true

  return {
    model,
    source: `openrouter:${model}`.slice(0, 64),
    version: SEARCH_TRACE_LLM_LABEL_VERSION,
    async classify(input) {
      if (!isLlmClassificationCandidate(input, { allowSensitiveOrAbusive })) {
        throw new SearchTraceQueryClassifierError(
          "not_allowed",
          "LLM classification is limited to ambiguous or high-impact non-sensitive traces",
        )
      }

      const body = JSON.stringify(buildRequestBody(model, input))
      let response: Response
      try {
        response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://admin.jesusfilm.org",
            "X-OpenRouter-Title": "Forge Admin Search Trace Classifier",
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "TimeoutError") {
          throw new SearchTraceQueryClassifierError(
            "timeout",
            `query classifier timed out after ${timeoutMs}ms`,
            cause,
          )
        }
        throw new SearchTraceQueryClassifierError(
          "transport",
          cause instanceof Error ? cause.message : String(cause),
          cause,
        )
      }

      if (!response.ok) {
        const responseBody = sanitizeDiagnosticText(
          await safeReadBody(response),
        )
        throw new SearchTraceQueryClassifierError(
          "request_failed",
          `query classifier status ${response.status}: ${responseBody.slice(0, 500)}`,
        )
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch (cause) {
        throw new SearchTraceQueryClassifierError(
          "validation",
          "query classifier response was not valid JSON",
          cause,
        )
      }

      const text = extractMessageContent(payload)
      if (text == null) {
        throw new SearchTraceQueryClassifierError(
          "validation",
          "query classifier response did not include text output",
        )
      }

      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(text)
      } catch (cause) {
        throw new SearchTraceQueryClassifierError(
          "validation",
          "query classifier response text was not valid JSON",
          cause,
        )
      }

      const validated = ClassificationResponseSchema.safeParse(parsedJson)
      if (!validated.success) {
        throw new SearchTraceQueryClassifierError(
          "validation",
          `query classifier response failed schema validation: ${validated.error.issues.map((i) => i.message).join(", ")}`,
        )
      }

      return validated.data
    },
  }
}

function extractMessageContent(payload: unknown): string | null {
  if (payload == null || typeof payload !== "object") return null
  const choices = (payload as Record<string, unknown>).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = (choices[0] as Record<string, unknown>).message
  if (message == null || typeof message !== "object") return null
  const content = (message as Record<string, unknown>).content
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part == null || typeof part !== "object") continue
      const text = (part as Record<string, unknown>).text
      if (typeof text === "string") return text
    }
  }
  return null
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 1000)
  } catch {
    return `(unreadable body, status=${response.status})`
  }
}

export function buildRequestBody(
  model: string,
  input: SearchTraceQueryClassificationInput,
) {
  const sanitizedQuery = sanitizeSearchTraceQueryForLlm(input.queryText)
  return {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(input, sanitizedQuery) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "search_trace_query_classification",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            queryQualityLabel: {
              type: "string",
              enum: QueryQualitySchema.options,
            },
            abuseLabel: {
              type: "string",
              enum: AbuseLabelSchema.options,
            },
            confidence: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
            reasonCode: {
              type: "string",
              minLength: 1,
              maxLength: 64,
              pattern: "^[a-z0-9_:-]+$",
            },
          },
          required: [
            "queryQualityLabel",
            "abuseLabel",
            "confidence",
            "reasonCode",
          ],
        },
      },
    },
    max_tokens: 300,
    temperature: 0,
  }
}

function buildSystemPrompt(): string {
  return [
    "Classify a sanitized production search query from a Christian video and content platform.",
    "Rules are authoritative. You only review ambiguous or high-impact samples after deterministic privacy redaction.",
    "Use the provided label enums exactly. Do not infer or output personal data.",
    "Return JSON matching the schema and no other text.",
  ].join("\n")
}

function buildUserPrompt(
  input: SearchTraceQueryClassificationInput,
  sanitizedQuery: string,
): string {
  return [
    `Sanitized query: ${JSON.stringify(sanitizedQuery)}`,
    `Locale: ${JSON.stringify(input.locale.slice(0, 32))}`,
    `Result count: ${input.resultCount}`,
    `Outcome: ${input.outcome}`,
    `Trace class: ${JSON.stringify(input.traceClass.slice(0, 64))}`,
    `Rule labels: queryQuality=${input.queryQualityLabel}, sensitivity=${input.sensitiveQueryLabel}, abuse=${input.abuseLabel}, ruleVersion=${SEARCH_TRACE_RULE_LABEL_VERSION}`,
    "Return the best labels for eval sampling review.",
  ].join("\n")
}

function compactReason(result: SearchTraceQueryClassification): string {
  return `${result.confidence}:${result.reasonCode}`.slice(0, 256)
}

export async function classifyAndStoreSearchTraceLlmLabel(
  prisma: PrismaClient,
  traceId: string,
  classifier: SearchTraceQueryClassifier,
  now: Date = new Date(),
): Promise<
  | { status: "classified"; result: SearchTraceQueryClassification }
  | {
      status: "skipped"
      reason: "not_found" | "not_candidate" | "already_classified" | "expired"
    }
> {
  const trace = await prisma.searchTrace.findUnique({
    where: { id: traceId },
    select: {
      queryText: true,
      locale: true,
      resultCount: true,
      outcome: true,
      traceClass: true,
      queryQualityLabel: true,
      sensitiveQueryLabel: true,
      abuseLabel: true,
      sampleEligible: true,
      rawExpiresAt: true,
      llmLabelSource: true,
    },
  })

  if (trace == null) return { status: "skipped", reason: "not_found" }
  if (trace.llmLabelSource != null) {
    return { status: "skipped", reason: "already_classified" }
  }
  if (trace.rawExpiresAt <= now) return { status: "skipped", reason: "expired" }

  const input = {
    queryText: trace.queryText,
    locale: trace.locale,
    resultCount: trace.resultCount,
    outcome: String(trace.outcome).toLowerCase() as
      | "success"
      | "degraded"
      | "failed",
    traceClass: trace.traceClass,
    queryQualityLabel: trace.queryQualityLabel as SearchTraceQueryQualityLabel,
    sensitiveQueryLabel:
      trace.sensitiveQueryLabel as SearchTraceSensitiveQueryLabel,
    abuseLabel: trace.abuseLabel as SearchTraceAbuseLabel,
  }

  const explicitlySafeAmbiguous =
    input.queryQualityLabel === "unknown_ambiguous" &&
    input.sensitiveQueryLabel === "none" &&
    input.abuseLabel === "none"
  if (!trace.sampleEligible && !explicitlySafeAmbiguous) {
    return { status: "skipped", reason: "not_candidate" }
  }

  if (!isLlmClassificationCandidate(input)) {
    return { status: "skipped", reason: "not_candidate" }
  }

  const result = await classifier.classify(input)
  const updated = await prisma.searchTrace.updateMany({
    where: {
      id: traceId,
      llmLabelSource: null,
      rawExpiresAt: { gt: now },
    },
    data: {
      llmQueryQualityLabel: result.queryQualityLabel,
      llmAbuseLabel: result.abuseLabel,
      llmLabelSource: classifier.source,
      llmLabelVersion: classifier.version,
      llmLabelReason: compactReason(result),
      llmLabeledAt: now,
    },
  })
  if (updated.count === 0) {
    return { status: "skipped", reason: "already_classified" }
  }

  return { status: "classified", result }
}
