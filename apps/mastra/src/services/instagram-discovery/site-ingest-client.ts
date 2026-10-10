import type { InstagramPost } from "./types"
import { requireHttpsUrl } from "../discovery/secure-url"

/**
 * Sends qualified posts to the website's review-queue ingest endpoint
 * (apps/aimedialab `/api/inspiration-candidates`). The site stores each as a
 * `draft` awaiting human approval and dedups by shortcode, so re-sending the
 * same post on a later run is a harmless no-op (that is the cross-run memory).
 * Opt-in: only runs when both the URL and token are configured.
 */

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
  const rawUrl = options.url?.trim()
  const token = options.token?.trim()
  if (!rawUrl || !token) {
    throw new SiteIngestError(
      "config_missing",
      "site ingest URL and token are required",
    )
  }
  if (posts.length === 0) return { ok: true, inserted: 0, skipped: 0 }

  let url: string
  try {
    url = requireHttpsUrl(rawUrl, "site ingest URL")
  } catch (error) {
    throw new SiteIngestError(
      "config_missing",
      error instanceof Error ? error.message : "site ingest URL must use HTTPS",
    )
  }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(toPayload(posts)),
      redirect: "error",
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

  if (
    body.ok !== true ||
    typeof body.inserted !== "number" ||
    !Number.isInteger(body.inserted) ||
    !Number.isFinite(body.inserted) ||
    body.inserted < 0 ||
    typeof body.skipped !== "number" ||
    !Number.isInteger(body.skipped) ||
    !Number.isFinite(body.skipped) ||
    body.skipped < 0
  ) {
    throw new SiteIngestError(
      "invalid_response",
      "site ingest returned an invalid success response",
    )
  }

  return { ok: true, inserted: body.inserted, skipped: body.skipped }
}

export const _internals = { toPayload }
