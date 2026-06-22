/**
 * Typed, single-attempt HTTP client for admin's bearer-gated agent-tool routes
 * (consolidation U8). The standalone chat agent's tools call admin over HTTP
 * (R2: never import admin) at `{ADMIN_AGENT_TOOLS_URL}/api/internal/agent-tools/
 * {search-videos,lookup-bible-verse,fetch-video-image}`.
 *
 * Mirrors the embedding-ingest + RAG clients: discriminated
 * `{ ok:true, data } | { ok:false, reason, retryable }` envelope, `Bearer` auth,
 * `AbortSignal.timeout`, `redirect:"error"` (no off-host redirect-follow), and a
 * no-throw surface so a misconfigured/unreachable admin degrades the agent's
 * tool to an empty result rather than crashing the turn.
 */

import { z } from "zod"

import {
  getAdminAgentToolsConfig,
  type AdminAgentToolsConfig,
} from "../config/env"

export type { AdminAgentToolsConfig } from "../config/env"

export type AdminAgentToolFailureReason =
  | "config_missing"
  | "auth_failed"
  | "timeout"
  | "network_error"
  | "rate_limited"
  | "rejected"
  | "parse_error"

export type AdminAgentToolFailure = {
  ok: false
  reason: AdminAgentToolFailureReason
  retryable: boolean
  status?: number
  /** Only set for `config_missing`: which half of the pair is absent. */
  detail?: "base_url_missing" | "api_key_missing"
}

export type AdminAgentToolResult<T> =
  | { ok: true; data: T }
  | AdminAgentToolFailure

function endpoint(baseUrl: string, path: string): URL {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  return new URL(path, normalized)
}

function failureForStatus(status: number): AdminAgentToolFailure {
  if (status === 401 || status === 403) {
    return { ok: false, reason: "auth_failed", retryable: false, status }
  }
  if (status === 429) {
    return { ok: false, reason: "rate_limited", retryable: true, status }
  }
  return {
    ok: false,
    reason: status >= 400 && status < 500 ? "rejected" : "network_error",
    retryable: status >= 500,
    status,
  }
}

/**
 * Generic agent-tool call. `parse` validates the admin 200 body into `T`
 * (returns null on shape mismatch → `parse_error`). The full failure reason is
 * for the caller's logs; nothing on this path throws.
 */
async function callAdminAgentTool<T>(args: {
  path: string
  body: unknown
  parse: (body: unknown) => T | null
  config?: AdminAgentToolsConfig
  fetchImpl?: typeof fetch
}): Promise<AdminAgentToolResult<T>> {
  const config = args.config ?? getAdminAgentToolsConfig()
  const fetchImpl = args.fetchImpl ?? fetch

  if (!config.baseUrl) {
    return {
      ok: false,
      reason: "config_missing",
      retryable: false,
      detail: "base_url_missing",
    }
  }
  if (!config.apiKey) {
    return {
      ok: false,
      reason: "config_missing",
      retryable: false,
      detail: "api_key_missing",
    }
  }

  let response: Response
  try {
    response = await fetchImpl(endpoint(config.baseUrl, args.path), {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        "user-agent": config.userAgent,
      },
      body: JSON.stringify(args.body),
      // Following a redirect would re-send the bearer to an unvetted host;
      // fail closed beyond the first hop.
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    const name = (error as { name?: string } | null | undefined)?.name
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, reason: "timeout", retryable: true }
    }
    return { ok: false, reason: "network_error", retryable: true }
  }

  if (!response.ok) {
    return failureForStatus(response.status)
  }

  const body = await response.json().catch(() => undefined)
  const data = args.parse(body)
  if (data === null) {
    return {
      ok: false,
      reason: "parse_error",
      retryable: false,
      status: response.status,
    }
  }
  return { ok: true, data }
}

// ---------------------------------------------------------------------------
// search-videos
// ---------------------------------------------------------------------------

const searchVideosResponseSchema = z.object({
  videos: z.array(
    z.object({
      videoId: z.string(),
      title: z.string(),
      snippet: z.string(),
      slug: z.string(),
      imageUrl: z.string().nullable(),
    }),
  ),
})
export type AdminSearchVideosData = z.infer<typeof searchVideosResponseSchema>

export type SearchVideosViaAdminInput = {
  q: string
  locale: string
  limit?: number
}

export async function searchVideosViaAdmin(
  input: SearchVideosViaAdminInput,
  options: {
    config?: AdminAgentToolsConfig
    fetchImpl?: typeof fetch
  } = {},
): Promise<AdminAgentToolResult<AdminSearchVideosData>> {
  return callAdminAgentTool({
    path: "api/internal/agent-tools/search-videos",
    body: {
      q: input.q,
      locale: input.locale,
      ...(input.limit == null ? {} : { limit: input.limit }),
    },
    parse: (body) => {
      const parsed = searchVideosResponseSchema.safeParse(body)
      return parsed.success ? parsed.data : null
    },
    config: options.config,
    fetchImpl: options.fetchImpl,
  })
}

// ---------------------------------------------------------------------------
// lookup-bible-verse
// ---------------------------------------------------------------------------

const lookupBibleVerseResponseSchema = z.object({
  books: z.array(
    z.object({
      bookId: z.string(),
      osisId: z.string().nullable(),
      displayName: z.string(),
      testament: z.string().nullable(),
      order: z.number().int().nullable(),
    }),
  ),
})
export type AdminLookupBibleVerseData = z.infer<
  typeof lookupBibleVerseResponseSchema
>

export type LookupBibleVerseViaAdminInput = {
  query: string
  locale?: string
  limit?: number
}

export async function lookupBibleVerseViaAdmin(
  input: LookupBibleVerseViaAdminInput,
  options: {
    config?: AdminAgentToolsConfig
    fetchImpl?: typeof fetch
  } = {},
): Promise<AdminAgentToolResult<AdminLookupBibleVerseData>> {
  return callAdminAgentTool({
    path: "api/internal/agent-tools/lookup-bible-verse",
    body: {
      query: input.query,
      ...(input.locale == null ? {} : { locale: input.locale }),
      ...(input.limit == null ? {} : { limit: input.limit }),
    },
    parse: (body) => {
      const parsed = lookupBibleVerseResponseSchema.safeParse(body)
      return parsed.success ? parsed.data : null
    },
    config: options.config,
    fetchImpl: options.fetchImpl,
  })
}

// ---------------------------------------------------------------------------
// fetch-video-image
// ---------------------------------------------------------------------------

const fetchVideoImageResponseSchema = z.object({
  imageUrl: z.string().nullable(),
  variant: z.string().nullable(),
})
export type AdminFetchVideoImageData = z.infer<
  typeof fetchVideoImageResponseSchema
>

export type FetchVideoImageViaAdminInput = {
  videoId: string
}

export async function fetchVideoImageViaAdmin(
  input: FetchVideoImageViaAdminInput,
  options: {
    config?: AdminAgentToolsConfig
    fetchImpl?: typeof fetch
  } = {},
): Promise<AdminAgentToolResult<AdminFetchVideoImageData>> {
  return callAdminAgentTool({
    path: "api/internal/agent-tools/fetch-video-image",
    body: { videoId: input.videoId },
    parse: (body) => {
      const parsed = fetchVideoImageResponseSchema.safeParse(body)
      return parsed.success ? parsed.data : null
    },
    config: options.config,
    fetchImpl: options.fetchImpl,
  })
}

export const _internals = { callAdminAgentTool }
