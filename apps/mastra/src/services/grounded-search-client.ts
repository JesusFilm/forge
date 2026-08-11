import { createHash, randomUUID } from "node:crypto"

import { z } from "zod"

import {
  getSeoConfig,
  getSeoLlmProviderConfig,
  type SeoConfig,
} from "../config/seo"
import { minimizeSeoText, minimizeSeoUrl } from "./seo-data-minimization"
import type { SeoEvidenceObservation, SeoProviderFailure } from "./seo-evidence"
import { readSeoJson } from "./seo-http"

const SourceSchema = z
  .object({
    url: z.string().optional(),
    title: z.string().nullable().optional(),
  })
  .passthrough()
const AnnotationSchema = SourceSchema.extend({ type: z.string() }).passthrough()
const ContentSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    refusal: z.string().optional(),
    annotations: z.array(AnnotationSchema).optional().default([]),
  })
  .passthrough()
const OutputItemSchema = z
  .object({
    type: z.string(),
    content: z.array(ContentSchema).optional().default([]),
    action: z
      .object({
        query: z.string().optional(),
        queries: z.array(z.string()).optional(),
        sources: z.array(SourceSchema).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
const ResponsesBodySchema = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    output: z.array(OutputItemSchema).max(100),
  })
  .passthrough()

export type GroundedSearchResult =
  | { ok: true; observation: SeoEvidenceObservation }
  | SeoProviderFailure

function statusFailure(status: number): SeoProviderFailure {
  if (status === 401 || status === 403) {
    return { ok: false, reason: "auth_failed", retryable: false, status }
  }
  if (status === 429) {
    return { ok: false, reason: "rate_limited", retryable: true, status }
  }
  return {
    ok: false,
    reason: status >= 500 ? "network_error" : "rejected",
    retryable: status >= 500,
    status,
  }
}

export async function searchGroundedWeb(input: {
  query: string
  canonicalUrl?: string
  locale?: string
  config?: SeoConfig
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  observationId?: string
}): Promise<GroundedSearchResult> {
  const config = input.config ?? getSeoConfig()
  const provider = getSeoLlmProviderConfig(config)
  if (!provider) {
    return { ok: false, reason: "config_missing", retryable: false }
  }
  const useOpenRouter = provider.id === "openrouter"
  const query = minimizeSeoText(input.query, 500).trim()
  if (!query) return { ok: false, reason: "rejected", retryable: false }
  const fetchImpl = input.fetchImpl ?? fetch
  const sleep =
    input.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  let responseBody: unknown
  for (let attempt = 1; attempt <= config.maxProviderAttempts; attempt += 1) {
    let response: Response
    try {
      response = await fetchImpl(`${provider.baseUrl}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${provider.apiKey}`,
          "content-type": "application/json",
          "user-agent": "forge-mastra-seo/1.0",
        },
        body: JSON.stringify({
          model: provider.model,
          input: query,
          tools: [
            useOpenRouter
              ? {
                  type: "openrouter:web_search",
                  parameters: {
                    engine: "auto",
                    max_results: 5,
                    max_uses: 1,
                    max_total_results: 5,
                    search_context_size: "low",
                  },
                }
              : { type: "web_search" },
          ],
          tool_choice: "required",
          ...(useOpenRouter
            ? { max_tool_calls: 1 }
            : { include: ["web_search_call.action.sources"] }),
          max_output_tokens: 1_500,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(config.timeoutMs),
      })
    } catch (error) {
      if (attempt < config.maxProviderAttempts) {
        await sleep(Math.min(250 * 2 ** (attempt - 1), 2_000))
        continue
      }
      return {
        ok: false,
        reason:
          error instanceof DOMException && error.name === "TimeoutError"
            ? "timeout"
            : "network_error",
        retryable: true,
      }
    }
    if (!response.ok) {
      const failure = statusFailure(response.status)
      if (failure.retryable && attempt < config.maxProviderAttempts) {
        await sleep(Math.min(250 * 2 ** (attempt - 1), 2_000))
        continue
      }
      return failure
    }
    responseBody = await readSeoJson(response, config.maxResponseBytes)
    if (responseBody === undefined) {
      return { ok: false, reason: "parse_error", retryable: true }
    }
    break
  }
  const parsed = ResponsesBodySchema.safeParse(responseBody)
  if (!parsed.success) {
    return { ok: false, reason: "parse_error", retryable: true }
  }

  const queries: string[] = []
  const outputText: string[] = []
  const refusals: string[] = []
  const sourceMap = new Map<string, { url: string; title: string | null }>()
  let searchCalls = 0
  const keepSource = (source: z.infer<typeof SourceSchema>) => {
    if (!source.url) return
    const url = minimizeSeoUrl(source.url)
    if (url && sourceMap.size < 50) {
      sourceMap.set(url, {
        url,
        title: source.title ? minimizeSeoText(source.title, 500) : null,
      })
    }
  }
  for (const item of parsed.data.output) {
    if (item.type === "web_search_call") {
      searchCalls += 1
      for (const candidate of [
        ...(item.action?.queries ?? []),
        ...(item.action?.query ? [item.action.query] : []),
      ]) {
        if (queries.length < 20) queries.push(minimizeSeoText(candidate, 500))
      }
      for (const source of item.action?.sources ?? []) keepSource(source)
    }
    for (const content of item.content) {
      if (content.type === "output_text" && content.text) {
        outputText.push(minimizeSeoText(content.text, 8_000))
      }
      if (content.type === "refusal" && content.refusal) {
        refusals.push(minimizeSeoText(content.refusal, 1_000))
      }
      for (const annotation of content.annotations) {
        if (annotation.type === "url_citation") keepSource(annotation)
      }
    }
  }
  const incomplete = parsed.data.status === "incomplete"
  const missingSearchCall = searchCalls === 0
  const refused = refusals.length > 0
  const sources = [...sourceMap.values()]
  return {
    ok: true,
    observation: {
      id:
        input.observationId ??
        `openai-web-${createHash("sha256")
          .update(`${query}:${randomUUID()}`)
          .digest("hex")
          .slice(0, 20)}`,
      provider: "openai_web_search",
      status:
        incomplete || missingSearchCall || refused ? "partial" : "available",
      retrievedAt: (input.now ?? (() => new Date()))().toISOString(),
      scope: {
        ...(input.canonicalUrl
          ? { canonicalUrl: minimizeSeoUrl(input.canonicalUrl) ?? undefined }
          : {}),
        ...(input.locale ? { locale: input.locale.slice(0, 35) } : {}),
      },
      data: {
        responseId: parsed.data.id ?? null,
        responseStatus: parsed.data.status ?? null,
        queries,
        outputText: outputText.join("\n").slice(0, 8_000),
        refusals,
        searchCallCount: searchCalls,
        sourceCount: sources.length,
      },
      quality: {
        complete: !incomplete && !missingSearchCall && !refused,
        truncated: sources.length >= 50,
        caveats: [
          "Grounded model output is an observation, not authoritative Search Console ranking evidence.",
          "Citation URLs are retained as bounded references and are never fetched automatically.",
          ...(incomplete
            ? ["The grounded-search provider reported an incomplete response."]
            : []),
          ...(missingSearchCall
            ? ["The response contained no web_search_call item."]
            : []),
          ...(refused ? ["The provider returned a refusal."] : []),
        ],
      },
      sources,
    },
  }
}
