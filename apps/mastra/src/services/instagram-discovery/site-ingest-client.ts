import type { InstagramPost } from "./types"

export type SiteIngestConfig = {
  url: string
  token: string
  timeoutMs?: number
}

export type SiteIngestResult = {
  ok: boolean
  inserted: number
  skipped: number
}

export type SiteIngestErrorCode =
  | "config_missing"
  | "auth_failed"
  | "upstream_failed"
  | "invalid_response"

export class SiteIngestError extends Error {
  constructor(
    readonly code: SiteIngestErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = "SiteIngestError"
  }
}

export type SubmitPostsOptions = SiteIngestConfig & {
  fetchImpl?: typeof fetch
}

function toPayload(posts: readonly InstagramPost[]) {
  return {
    posts: posts.map((post) => ({
      shortcode: post.shortcode,
      url: post.url,
      caption: post.caption,
      author: post.authorHandle,
      thumbnailUrl: post.thumbnailUrl,
      matchedAi: post.matchedAi,
      matchedChristian: post.matchedChristian,
    })),
  }
}

export async function submitPostsToSite(
  posts: readonly InstagramPost[],
  options: SubmitPostsOptions,
): Promise<SiteIngestResult> {
  const url = options.url?.trim()
  const token = options.token?.trim()
  if (!url || !token) {
    throw new SiteIngestError(
      "config_missing",
      "site ingest URL and token are required",
    )
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new SiteIngestError("config_missing", "site ingest URL is invalid")
  }
  if (parsedUrl.protocol !== "https:") {
    throw new SiteIngestError(
      "config_missing",
      "site ingest URL must use HTTPS",
    )
  }
  if (posts.length === 0) return { ok: true, inserted: 0, skipped: 0 }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(toPayload(posts)),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    })
  } catch (cause) {
    throw new SiteIngestError(
      "upstream_failed",
      `site ingest request failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      true,
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new SiteIngestError("auth_failed", "site ingest rejected the token")
  }
  if (!response.ok) {
    throw new SiteIngestError(
      "upstream_failed",
      `site ingest returned HTTP ${response.status}`,
      response.status >= 500,
    )
  }

  const body = (await response.json().catch(() => {
    throw new SiteIngestError(
      "invalid_response",
      "site ingest returned invalid JSON",
    )
  })) as { ok?: unknown; inserted?: unknown; skipped?: unknown }

  return {
    ok: body.ok === true,
    inserted: typeof body.inserted === "number" ? body.inserted : 0,
    skipped: typeof body.skipped === "number" ? body.skipped : 0,
  }
}

export const _internals = { toPayload }
