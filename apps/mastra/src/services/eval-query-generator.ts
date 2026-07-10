import { z } from "zod"

import type {
  AdminCatalogAnchor,
  AdminLocaleProfileSchema,
  AdminSearchEvalCandidatePayload,
  AdminTraceSample,
} from "./admin-search-eval-client"

const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions"
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_LOCALE_QUERY_COUNT = 2
const MAX_LOCALE_QUERY_COUNT = 10
const MAX_CATALOG_CANDIDATES = 50
const MAX_TRACE_CANDIDATES = 50

type AdminLocaleProfile = z.infer<typeof AdminLocaleProfileSchema>

const LocaleQueryResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            locale: z.string().min(1).max(32),
            query: z.string().trim().min(1).max(200),
            score: z.number().min(0).max(1),
            rationale: z.string().trim().min(1).max(240),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()

export class EvalQueryGeneratorError extends Error {
  constructor(
    readonly code:
      | "missing_credentials"
      | "request_failed"
      | "validation"
      | "timeout"
      | "transport",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "EvalQueryGeneratorError"
  }
}

export type EvalQueryGenerator = {
  readonly model: string
  generateLocaleQualityCandidates: (
    profiles: readonly AdminLocaleProfile[],
    countPerLocale?: number,
  ) => Promise<AdminSearchEvalCandidatePayload[]>
}

export type EvalQueryGeneratorOptions = {
  apiKey?: string
  model?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export type BuildEvalCandidatesInput = {
  catalogAnchors: readonly AdminCatalogAnchor[]
  traceSamples: readonly AdminTraceSample[]
  localeProfiles: readonly AdminLocaleProfile[]
  mastraRunId: string
  generatedAt: string
  generator?: EvalQueryGenerator
  localeQueryCount?: number
  includeSources?: ReadonlySet<"catalog" | "locale_quality" | "trace">
}

function sourceEnabled(
  includeSources:
    | ReadonlySet<"catalog" | "locale_quality" | "trace">
    | undefined,
  source: "catalog" | "locale_quality" | "trace",
): boolean {
  return includeSources == null || includeSources.has(source)
}

function compactText(
  value: string | null | undefined,
  max = 180,
): string | null {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim()
  return normalized.length === 0 ? null : normalized.slice(0, max)
}

function catalogQuery(anchor: AdminCatalogAnchor): string {
  if (anchor.source === "video" && anchor.keywords.length > 0) {
    return `${anchor.title} ${anchor.keywords[0]}`.slice(0, 200)
  }
  return anchor.title.slice(0, 200)
}

function candidateFromCatalogAnchor(
  anchor: AdminCatalogAnchor,
  mastraRunId: string,
  generatedAt: string,
): AdminSearchEvalCandidatePayload {
  return {
    source: "catalog",
    locale: anchor.locale,
    queryText: catalogQuery(anchor),
    expectedResultHints: anchor.expectedResultHints,
    sourceAnchors: [
      {
        type: anchor.source,
        id: anchor.id,
        locale: anchor.locale,
        title: anchor.title,
        slug: anchor.slug,
        snippet: compactText(anchor.snippet),
      },
    ],
    labelProvenance: {
      source: "admin_catalog_context",
      anchorSource: anchor.source,
    },
    generationModel: "mastra-catalog-anchor:v1",
    generationProvider: "mastra",
    judgeSummary: {
      source: "source_anchor_heuristic",
      score: 0.9,
      rationale: "Query is directly anchored to a published catalog item.",
    },
    mastraRunId,
    generatedAt,
  }
}

function candidateFromTraceSample(
  trace: AdminTraceSample,
  mastraRunId: string,
  generatedAt: string,
): AdminSearchEvalCandidatePayload {
  return {
    source: "trace",
    locale: trace.locale,
    queryText: trace.queryText,
    sourceAnchors: [
      {
        type: "trace",
        id: trace.id,
        routeSource: trace.routeSource,
        createdAt: trace.createdAt,
      },
    ],
    labelProvenance: {
      queryQualityLabel: trace.queryQualityLabel,
      sensitiveQueryLabel: trace.sensitiveQueryLabel,
      abuseLabel: trace.abuseLabel,
      queryLabelSource: trace.queryLabelSource,
      queryLabelVersion: trace.queryLabelVersion,
      queryLabeledAt: trace.queryLabeledAt,
      llmQueryQualityLabel: trace.llmQueryQualityLabel,
      llmAbuseLabel: trace.llmAbuseLabel,
      llmLabelSource: trace.llmLabelSource,
      llmLabelVersion: trace.llmLabelVersion,
      llmLabeledAt: trace.llmLabeledAt,
    },
    generationModel: "admin-trace-sample:v1",
    generationProvider: "admin",
    judgeSummary: {
      source: "admin_trace_labels",
      score: trace.queryQualityLabel === "valid_viewer_intent" ? 1 : 0.5,
      rationale: "Candidate was sampled after Admin trace quality filters.",
    },
    mastraRunId,
    retentionExpiresAt: trace.rawExpiresAt,
    generatedAt,
  }
}

function extractMessageContent(payload: unknown): string | null {
  if (payload == null || typeof payload !== "object") return null
  const choices = (payload as Record<string, unknown>).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = (choices[0] as Record<string, unknown>).message
  if (message == null || typeof message !== "object") return null
  const content = (message as Record<string, unknown>).content
  return typeof content === "string" ? content : null
}

export function createEvalQueryGenerator(
  options: EvalQueryGeneratorOptions = {},
): EvalQueryGenerator {
  const apiKey = options.apiKey
  if (!apiKey) {
    throw new EvalQueryGeneratorError(
      "missing_credentials",
      "OPENROUTER_API_PAID_KEY or OPENROUTER_API_KEY is required for locale-quality eval query generation",
    )
  }
  const model = options.model ?? "anthropic/claude-haiku-4-5"
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    model,
    async generateLocaleQualityCandidates(
      profiles,
      countPerLocale = DEFAULT_LOCALE_QUERY_COUNT,
    ) {
      if (profiles.length === 0) return []
      const count = Math.min(
        MAX_LOCALE_QUERY_COUNT,
        Math.max(1, Math.floor(countPerLocale)),
      )
      const body = JSON.stringify(
        buildLocaleRequestBody(model, profiles, count),
      )
      let response: Response
      try {
        response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://mastra.jesusfilm.org",
            "X-OpenRouter-Title": "Forge Mastra Eval Query Generation",
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "TimeoutError") {
          throw new EvalQueryGeneratorError(
            "timeout",
            `eval query generation timed out after ${timeoutMs}ms`,
            cause,
          )
        }
        throw new EvalQueryGeneratorError(
          "transport",
          cause instanceof Error ? cause.message : String(cause),
          cause,
        )
      }

      if (!response.ok) {
        throw new EvalQueryGeneratorError(
          "request_failed",
          `eval query generation status ${response.status}`,
        )
      }

      const payload = await response.json().catch((cause) => {
        throw new EvalQueryGeneratorError(
          "validation",
          "eval query generation response was not valid JSON",
          cause,
        )
      })
      const text = extractMessageContent(payload)
      if (text == null) {
        throw new EvalQueryGeneratorError(
          "validation",
          "eval query generation response did not include text output",
        )
      }

      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(text)
      } catch (cause) {
        throw new EvalQueryGeneratorError(
          "validation",
          "eval query generation response text was not valid JSON",
          cause,
        )
      }

      const parsed = LocaleQueryResponseSchema.safeParse(parsedJson)
      if (!parsed.success) {
        throw new EvalQueryGeneratorError(
          "validation",
          "eval query generation response failed schema validation",
          parsed.error,
        )
      }

      return parsed.data.candidates.map((candidate) => ({
        source: "locale_quality" as const,
        locale: candidate.locale,
        queryText: candidate.query,
        sourceAnchors: [
          {
            type: "locale",
            locale: candidate.locale,
          },
        ],
        labelProvenance: {
          source: "locale_quality_generation",
          localeTier:
            profiles.find((profile) => profile.locale === candidate.locale)
              ?.tier ?? null,
        },
        generationModel: model,
        generationProvider: "openrouter",
        judgeSummary: {
          source: "generation_model",
          score: candidate.score,
          rationale: candidate.rationale,
        },
      }))
    },
  }
}

function buildLocaleRequestBody(
  model: string,
  profiles: readonly AdminLocaleProfile[],
  countPerLocale: number,
) {
  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "Generate locale-quality search eval candidates for a Christian video and content platform.",
          "Queries should be realistic viewer intent in the requested locale language.",
          "Return JSON only. Judge score is advisory and is not human regression truth.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          countPerLocale,
          locales: profiles.map((profile) => ({
            locale: profile.locale,
            tier: profile.tier,
          })),
        }),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "mastra_eval_locale_queries",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            candidates: {
              type: "array",
              minItems: 1,
              maxItems: 200,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  locale: { type: "string", minLength: 1, maxLength: 32 },
                  query: { type: "string", minLength: 1, maxLength: 200 },
                  score: { type: "number", minimum: 0, maximum: 1 },
                  rationale: { type: "string", minLength: 1, maxLength: 240 },
                },
                required: ["locale", "query", "score", "rationale"],
              },
            },
          },
          required: ["candidates"],
        },
      },
    },
    max_tokens: 2000,
    temperature: 0.7,
  }
}

export async function buildEvalQueryCandidates({
  catalogAnchors,
  traceSamples,
  localeProfiles,
  mastraRunId,
  generatedAt,
  generator,
  localeQueryCount,
  includeSources,
}: BuildEvalCandidatesInput): Promise<AdminSearchEvalCandidatePayload[]> {
  const candidates: AdminSearchEvalCandidatePayload[] = []

  if (sourceEnabled(includeSources, "catalog")) {
    candidates.push(
      ...catalogAnchors
        .slice(0, MAX_CATALOG_CANDIDATES)
        .map((anchor) =>
          candidateFromCatalogAnchor(anchor, mastraRunId, generatedAt),
        ),
    )
  }

  if (sourceEnabled(includeSources, "trace")) {
    candidates.push(
      ...traceSamples
        .slice(0, MAX_TRACE_CANDIDATES)
        .map((trace) =>
          candidateFromTraceSample(trace, mastraRunId, generatedAt),
        ),
    )
  }

  if (sourceEnabled(includeSources, "locale_quality")) {
    if (!generator) {
      throw new EvalQueryGeneratorError(
        "missing_credentials",
        "locale-quality generation requires an eval query generator",
      )
    }
    const localeCandidates = await generator.generateLocaleQualityCandidates(
      localeProfiles,
      localeQueryCount,
    )
    candidates.push(
      ...localeCandidates.map((candidate) => ({
        ...candidate,
        mastraRunId,
        generatedAt,
      })),
    )
  }

  return candidates
}

export const _internal = {
  buildLocaleRequestBody,
  candidateFromCatalogAnchor,
  candidateFromTraceSample,
}
