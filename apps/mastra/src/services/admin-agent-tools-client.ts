/**
 * Typed, single-attempt HTTP client for admin's bearer-gated agent-tool routes
 * (consolidation U8). The standalone chat agent's tools call admin over HTTP
 * (R2: never import admin) at `{ADMIN_AGENT_TOOLS_URL}/api/internal/agent-tools/
 * {search-videos,lookup-bible-verse,fetch-video-image}`.
 *
 * Mirrors the embedding-ingest + RAG clients: discriminated
 * `{ ok:true, data } | { ok:false, reason, retryable }` envelope, `Bearer` auth,
 * `AbortSignal.timeout`, an SSRF host allowlist (`ADMIN_AGENT_TOOLS_ALLOWED_HOSTS`,
 * checked before any fetch) + `redirect:"error"` (no off-host redirect-follow) so
 * the bearer never bleeds to an unvetted host, and a no-throw surface so a
 * misconfigured/unreachable admin degrades the agent's tool to an empty result
 * rather than crashing the turn.
 */

import { z } from "zod"

import {
  getAdminAgentToolsConfig,
  type AdminAgentToolsConfig,
} from "../config/env"

export type { AdminAgentToolsConfig } from "../config/env"

export type AdminAgentToolFailureReason =
  | "config_missing"
  | "ssrf_blocked"
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

/**
 * SSRF guard: when `allowedHostsCsv` is set, the base URL host must be in it
 * before any fetch, so the bearer never bleeds to an unvetted host. Unset → the
 * operator-set base host is trusted (`redirect:"error"` still blocks off-host
 * hops). Mirrors `hostAllowed` in admin's `mastra-experience-chat-client.ts`.
 */
function hostAllowed(
  baseUrl: string,
  allowedHostsCsv: string | undefined,
): boolean {
  if (!allowedHostsCsv) return true
  let host: string
  try {
    host = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  const allowed = new Set(
    allowedHostsCsv
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  )
  return allowed.has(host)
}

/**
 * Copied from `langfuse-prompt-client.ts` / `jesusfilm-rag-client.ts` (feat-202
 * byte-cap OOM guard; no shared helpers module exists yet). Applied here in
 * feat-327, when this client first entered a user-facing conversational path
 * (the seeker's `searchVideos`) inside the single Node process that runs every
 * Mastra agent and workflow.
 *
 * Read and JSON-parse a response body, bounded at `maxBytes`. Streams the body
 * with a running byte counter rather than trusting `Content-Length` (absent or
 * spoofable); the instant the counter exceeds `maxBytes` it cancels the reader
 * — aborting the underlying socket so a misbehaving upstream can't keep filling
 * the heap — and returns `undefined`.
 *
 * Returns `undefined` on EVERY failure mode (absent body, read error, over-cap,
 * decode error, JSON parse error), preserving the no-throw surface: over-cap
 * rides the EXISTING `undefined → parse_error` graceful path, which every tool
 * already degrades to an empty result. The catch swallows silently and MUST NOT
 * log the caught error: a `JSON.parse` `SyntaxError` can embed raw body
 * fragments (here: catalog snippets), and logging it would leak them.
 *
 * This client reads a body ONLY on the 200 path — `failureForStatus` classifies
 * from the status code alone and never touches the error body — so this is the
 * one and only buffering read to guard.
 */
async function readJsonBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const stream = response.body
  if (!stream) return undefined
  // `reader` is acquired INSIDE the try and released in a guarded `finally` so
  // BOTH ends of the no-throw boundary are structural, not dependent on timing:
  // a `getReader()` throw (e.g. a double-locked body) is swallowed to undefined,
  // and `releaseLock()` (which throws if a read is still pending) can never
  // escape and mask the graceful return.
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        // Abort the underlying stream (not merely stop reading) so the socket
        // stops filling the heap. The over-cap body then degrades gracefully.
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(merged))
  } catch {
    return undefined
  } finally {
    try {
      reader?.releaseLock()
    } catch {
      // Cleanup must never escape — see the no-throw boundary note above.
    }
  }
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
  // SSRF guard — fail closed before the bearer is attached to a request.
  if (!hostAllowed(config.baseUrl, config.allowedHosts)) {
    return { ok: false, reason: "ssrf_blocked", retryable: false }
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

  // Byte-capped (feat-327) — an over-cap body maps to `undefined`, which the
  // parse below turns into the EXISTING `parse_error` graceful path. No new
  // branch, and the caught error is never logged (leak control).
  const body = await readJsonBodyCapped(response, config.maxResponseBytes)
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

/**
 * Wire-parse contract for admin's `/api/internal/agent-tools/search-videos`.
 *
 * The playback trio (`playbackId`/`durationSeconds`/`languageSlug`, admin PR
 * #1789) and `availability` (feat-326) are all `.optional()` per plan P5, so a
 * pre-widening admin deployment still validates and the tool simply sees rows
 * that are not featurable. `availability.kind` is a TOLERANT string, never a
 * closed enum: an unknown future kind must parse fine and then fail-close at
 * the seeker tool's `=== "target_audio"` comparison, rather than failing the
 * parse and collapsing the whole search to empty.
 *
 * `playbackId` is `.optional()` but NOT `.nullable()` — it mirrors the producer
 * contract, where admin's `playbackId !== null` playability filter runs before
 * projection. A hypothetical null would fail this parse into the EXISTING
 * `parse_error` → empty-result path: fail-closed and graceful, never a throw.
 *
 * Kept structurally identical to `searchVideosOutputSchema` in
 * `../mastra/tools/search-videos.ts` (the shared executor is a pass-through);
 * a parity test in `../mastra/tools/agent-tools.test.ts` pins the two row shapes
 * against each other so they cannot drift.
 */
const searchVideosResponseSchema = z.object({
  videos: z.array(
    z.object({
      videoId: z.string(),
      title: z.string(),
      snippet: z.string(),
      slug: z.string(),
      imageUrl: z.string().nullable(),
      playbackId: z.string().optional(),
      durationSeconds: z.number().nullable().optional(),
      languageSlug: z.string().nullable().optional(),
      availability: z
        .object({
          kind: z.string(),
          languageSlug: z.string().nullable().optional(),
        })
        .optional(),
    }),
  ),
})

/** Exported for the drift guard in `../mastra/tools/agent-tools.test.ts`. */
export const _searchVideosResponseSchema = searchVideosResponseSchema
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
