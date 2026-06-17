import type { DiscoveredVideo } from "./candidate"

/**
 * Sends discovered videos to the website's review-queue ingest endpoint
 * (apps/aimedialab `/api/inspiration-candidates`). The site stores each as a
 * `draft` awaiting human approval and dedups by `(platform, externalId)`, so
 * re-sending the same video on a later run is a harmless no-op (cross-run memory).
 *
 * Platform-agnostic successor to the Instagram-only site-ingest client: every
 * payload carries an explicit `platform` and an author link for attribution.
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

export type SubmitCandidatesOptions = SiteIngestConfig & {
  fetchImpl?: typeof fetch
}

function toPayload(candidates: readonly DiscoveredVideo[]) {
  return {
    posts: candidates.map((candidate) => ({
      platform: candidate.platform,
      externalId: candidate.externalId,
      url: candidate.url,
      caption: candidate.caption,
      author: candidate.authorHandle,
      authorName: candidate.authorName,
      authorUrl: candidate.authorUrl,
      thumbnailUrl: candidate.thumbnailUrl,
      matchedAi: candidate.matchedAi,
      matchedChristian: candidate.matchedChristian,
    })),
  }
}

export async function submitCandidatesToSite(
  candidates: readonly DiscoveredVideo[],
  options: SubmitCandidatesOptions,
): Promise<SiteIngestResult> {
  const url = options.url?.trim()
  const token = options.token?.trim()
  if (!url || !token) {
    throw new SiteIngestError(
      "config_missing",
      "site ingest URL and token are required",
    )
  }
  if (candidates.length === 0) return { ok: true, inserted: 0, skipped: 0 }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(toPayload(candidates)),
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
