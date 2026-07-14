import { z } from "zod"

import { getFirecrawlConfig, type FirecrawlConfig } from "../config/env"

export type { FirecrawlConfig } from "../config/env"

export type FirecrawlClientFailure = {
  ok: false
  reason:
    | "config_missing"
    | "auth_failed"
    | "network_error"
    | "rate_limited"
    | "rejected"
    | "parse_error"
    | "invalid_response"
  retryable: boolean
  status?: number
  upstreamReason?: string
}

export type FirecrawlClientResult<TResult> =
  | { ok: true; result: TResult }
  | FirecrawlClientFailure

export type FirecrawlSearchResult = {
  title: string | null
  url: string
  description: string | null
  markdown: string | null
  markdownTruncated: boolean
}

export type FirecrawlSearchResponse = {
  query: string
  results: FirecrawlSearchResult[]
  creditsUsed: number | null
}

export type FirecrawlScrapeResponse = {
  url: string
  markdown: string
  markdownTruncated: boolean
  title: string | null
  description: string | null
  statusCode: number | null
  contentType: string | null
}

export type FirecrawlSearchInput = {
  query: string
  limit?: number
  includeMarkdown?: boolean
  timeoutMs?: number
  config?: FirecrawlConfig
  fetchImpl?: typeof fetch
  maxAttempts?: number
  sleep?: (ms: number) => Promise<void>
}

export type FirecrawlScrapeInput = {
  url: string
  onlyMainContent?: boolean
  timeoutMs?: number
  config?: FirecrawlConfig
  fetchImpl?: typeof fetch
  maxAttempts?: number
  sleep?: (ms: number) => Promise<void>
}

const SearchResultSchema = z
  .object({
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    url: z.string().url(),
    markdown: z.string().nullable().optional(),
  })
  .passthrough()

const SearchDataSchema = z
  .object({
    web: z.array(SearchResultSchema).default([]),
  })
  .passthrough()

const SearchResponseSchema = z.union([
  z
    .object({
      success: z.boolean().optional(),
      data: SearchDataSchema,
      creditsUsed: z.number().nullable().optional(),
    })
    .passthrough()
    .transform((body) => ({
      success: body.success,
      web: body.data.web,
      creditsUsed: body.creditsUsed ?? null,
    })),
  z
    .object({
      success: z.boolean().optional(),
      web: z.array(SearchResultSchema).default([]),
      creditsUsed: z.number().nullable().optional(),
    })
    .passthrough()
    .transform((body) => ({
      success: body.success,
      web: body.web,
      creditsUsed: body.creditsUsed ?? null,
    })),
])

const ScrapeMetadataSchema = z
  .object({
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    sourceURL: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    statusCode: z.number().nullable().optional(),
    contentType: z.string().nullable().optional(),
  })
  .passthrough()

const ScrapeDataSchema = z
  .object({
    markdown: z.string().nullable().optional(),
    metadata: ScrapeMetadataSchema.nullable().optional(),
  })
  .passthrough()

const ScrapeResponseSchema = z.union([
  z
    .object({
      success: z.boolean().optional(),
      data: ScrapeDataSchema,
    })
    .passthrough()
    .transform((body) => ({
      success: body.success,
      markdown: body.data.markdown ?? "",
      metadata: body.data.metadata ?? null,
    })),
  z
    .object({
      success: z.boolean().optional(),
      markdown: z.string().nullable().optional(),
      metadata: ScrapeMetadataSchema.nullable().optional(),
    })
    .passthrough()
    .transform((body) => ({
      success: body.success,
      markdown: body.markdown ?? "",
      metadata: body.metadata ?? null,
    })),
])

function clampLimit(value: number | undefined, max: number): number {
  if (value == null) return max
  return Math.max(1, Math.min(value, max))
}

function endpoint(apiUrl: string, path: string): URL {
  const normalized = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`
  return new URL(path, normalized)
}

function retryAfterMs(value: string | null): number | null {
  if (value == null) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 60_000)
  }
  return null
}

function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 30_000)
}

function truncateText(
  value: string | null | undefined,
  maxCharacters: number,
): { text: string; truncated: boolean } {
  const text = value ?? ""
  const codepoints = Array.from(text)
  if (codepoints.length <= maxCharacters) {
    return { text, truncated: false }
  }
  if (maxCharacters <= 3) {
    return {
      text: "...".slice(0, maxCharacters),
      truncated: true,
    }
  }
  return {
    text: `${codepoints.slice(0, Math.max(0, maxCharacters - 3)).join("")}...`,
    truncated: true,
  }
}

function safeReason(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined
  const codepoints = Array.from(value)
  return codepoints.length <= 300
    ? value
    : `${codepoints.slice(0, 297).join("")}...`
}

async function readUpstreamReason(
  response: Response,
): Promise<string | undefined> {
  const body = await response.json().catch(() => undefined)
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined
  const record = body as { error?: unknown; message?: unknown }
  return safeReason(record.error) ?? safeReason(record.message)
}

function failureForStatus(
  status: number,
  upstreamReason?: string,
): FirecrawlClientFailure {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status,
      upstreamReason,
    }
  }
  if (status === 429) {
    return {
      ok: false,
      reason: "rate_limited",
      retryable: true,
      status,
      upstreamReason,
    }
  }
  return {
    ok: false,
    reason: status >= 400 && status < 500 ? "rejected" : "network_error",
    retryable: status >= 500,
    status,
    upstreamReason,
  }
}

async function postFirecrawlJson<TResult>({
  path,
  payload,
  schema,
  config,
  timeoutMs,
  fetchImpl,
  maxAttempts,
  sleep,
}: {
  path: string
  payload: unknown
  schema: z.ZodType<TResult>
  config: FirecrawlConfig
  timeoutMs?: number
  fetchImpl: typeof fetch
  maxAttempts: number
  sleep: (ms: number) => Promise<void>
}): Promise<FirecrawlClientResult<TResult>> {
  if (!config.apiKey) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  let lastFailure: FirecrawlClientFailure | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response
    try {
      response = await fetchImpl(endpoint(config.apiUrl, path), {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
          "user-agent": config.userAgent,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs ?? config.timeoutMs),
      })
    } catch {
      lastFailure = { ok: false, reason: "network_error", retryable: true }
      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt))
        continue
      }
      return lastFailure
    }

    if (response.status === 429) {
      lastFailure = failureForStatus(
        response.status,
        await readUpstreamReason(response),
      )
      if (attempt < maxAttempts) {
        await sleep(
          retryAfterMs(response.headers.get("retry-after")) ??
            backoffMs(attempt),
        )
        continue
      }
      return lastFailure
    }

    if (response.status === 401 || response.status === 403) {
      return failureForStatus(
        response.status,
        await readUpstreamReason(response),
      )
    }

    if (!response.ok) {
      const failure = failureForStatus(
        response.status,
        await readUpstreamReason(response),
      )
      if (failure.retryable && attempt < maxAttempts) {
        await sleep(backoffMs(attempt))
        continue
      }
      return failure
    }

    const body = await response.json().catch(() => undefined)
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return {
        ok: false,
        reason: "parse_error",
        retryable: true,
        status: response.status,
      }
    }
    const parsedRecord = parsed.data as { success?: boolean }
    if (parsedRecord.success === false) {
      return {
        ok: false,
        reason: "invalid_response",
        retryable: true,
        status: response.status,
      }
    }

    return { ok: true, result: parsed.data }
  }

  return lastFailure ?? { ok: false, reason: "network_error", retryable: true }
}

export async function searchFirecrawl({
  query,
  limit,
  includeMarkdown = false,
  timeoutMs,
  config = getFirecrawlConfig(),
  fetchImpl = fetch,
  maxAttempts = 3,
  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}: FirecrawlSearchInput): Promise<
  FirecrawlClientResult<FirecrawlSearchResponse>
> {
  const effectiveLimit = clampLimit(limit, config.maxSearchResults)
  const response = await postFirecrawlJson({
    path: "v2/search",
    payload: {
      query,
      limit: effectiveLimit,
      sources: ["web"],
      timeout: timeoutMs ?? config.timeoutMs,
      ignoreInvalidURLs: true,
      ...(includeMarkdown
        ? {
            scrapeOptions: {
              formats: ["markdown"],
              onlyMainContent: true,
              timeout: timeoutMs ?? config.timeoutMs,
            },
          }
        : {}),
    },
    schema: SearchResponseSchema,
    config,
    timeoutMs,
    fetchImpl,
    maxAttempts,
    sleep,
  })
  if (!response.ok) return response

  return {
    ok: true,
    result: {
      query,
      creditsUsed: response.result.creditsUsed,
      results: response.result.web.slice(0, effectiveLimit).map((item) => {
        const markdown = truncateText(
          item.markdown,
          config.maxMarkdownCharacters,
        )
        return {
          title: item.title ?? null,
          url: item.url,
          description: item.description ?? null,
          markdown: item.markdown == null ? null : markdown.text,
          markdownTruncated: item.markdown == null ? false : markdown.truncated,
        }
      }),
    },
  }
}

export async function scrapeFirecrawl({
  url,
  onlyMainContent = true,
  timeoutMs,
  config = getFirecrawlConfig(),
  fetchImpl = fetch,
  maxAttempts = 3,
  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}: FirecrawlScrapeInput): Promise<
  FirecrawlClientResult<FirecrawlScrapeResponse>
> {
  const response = await postFirecrawlJson({
    path: "v2/scrape",
    payload: {
      url,
      formats: ["markdown"],
      onlyMainContent,
      timeout: timeoutMs ?? config.timeoutMs,
    },
    schema: ScrapeResponseSchema,
    config,
    timeoutMs,
    fetchImpl,
    maxAttempts,
    sleep,
  })
  if (!response.ok) return response

  const markdown = truncateText(
    response.result.markdown,
    config.maxMarkdownCharacters,
  )
  const metadata = response.result.metadata
  return {
    ok: true,
    result: {
      url: metadata?.sourceURL ?? metadata?.url ?? url,
      markdown: markdown.text,
      markdownTruncated: markdown.truncated,
      title: metadata?.title ?? null,
      description: metadata?.description ?? null,
      statusCode: metadata?.statusCode ?? null,
      contentType: metadata?.contentType ?? null,
    },
  }
}
