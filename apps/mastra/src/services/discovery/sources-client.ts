import type { Platform } from "./candidate"
import { requireHttpsUrl } from "./secure-url"

/**
 * Reads the website's saved trusted-source list for a platform
 * (apps/aimedialab `GET /api/discovery-sources?platform=<p>`). Lets the bots run
 * from a persistent, self-serve list instead of Studio Run-form input.
 * Opt-in: callers pass config from `getDiscoverySourcesConfig()`, which is null
 * unless configured.
 */

export type SourcesConfig = {
  url: string
  token: string
  timeoutMs?: number
}

/** One saved source: the raw link/handle/playlist value + the user's label. */
export type SavedSource = {
  value: string
  label: string
}

export type SourcesFetchErrorCode =
  | "config_missing"
  | "auth_failed"
  | "upstream_failed"
  | "invalid_response"

export class SourcesFetchError extends Error {
  constructor(
    readonly code: SourcesFetchErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = "SourcesFetchError"
  }
}

export type FetchSavedSourcesOptions = SourcesConfig & {
  fetchImpl?: typeof fetch
}

function sourcesEndpoint(baseUrl: string, platform: Platform): string {
  const url = new URL(requireHttpsUrl(baseUrl, "discovery sources URL"))
  url.searchParams.set("platform", platform)
  return url.toString()
}

/**
 * Fetch the saved sources for one platform. Returns `[]` when the website has
 * none. Throws `SourcesFetchError` on transport/auth/parse failure so the caller
 * can fall back to Run-form input.
 */
export async function fetchSavedSources(
  platform: Platform,
  options: FetchSavedSourcesOptions,
): Promise<SavedSource[]> {
  const url = options.url?.trim()
  const token = options.token?.trim()
  if (!url || !token) {
    throw new SourcesFetchError(
      "config_missing",
      "discovery sources URL and token are required",
    )
  }

  let endpoint: string
  try {
    endpoint = sourcesEndpoint(url, platform)
  } catch (error) {
    throw new SourcesFetchError(
      "config_missing",
      error instanceof Error
        ? error.message
        : "discovery sources URL must use HTTPS",
    )
  }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    })
  } catch (cause) {
    throw new SourcesFetchError(
      "upstream_failed",
      `discovery sources request failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      true,
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new SourcesFetchError(
      "auth_failed",
      "discovery sources rejected the token",
    )
  }
  if (!response.ok) {
    throw new SourcesFetchError(
      "upstream_failed",
      `discovery sources returned HTTP ${response.status}`,
      response.status >= 500,
    )
  }

  const body = (await response.json().catch(() => {
    throw new SourcesFetchError(
      "invalid_response",
      "discovery sources returned invalid JSON",
    )
  })) as { sources?: unknown }

  if (!Array.isArray(body.sources)) {
    throw new SourcesFetchError(
      "invalid_response",
      "discovery sources response missing a sources array",
    )
  }

  const sources: SavedSource[] = []
  for (const entry of body.sources) {
    if (entry && typeof entry === "object" && "value" in entry) {
      const value = String((entry as { value: unknown }).value ?? "").trim()
      const label = String((entry as { label?: unknown }).label ?? "").trim()
      if (value) sources.push({ value, label })
    }
  }
  return sources
}

export const _internals = { sourcesEndpoint }
