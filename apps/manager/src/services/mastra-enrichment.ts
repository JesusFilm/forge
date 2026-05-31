import { env } from "@/config/env"
import type { VideoEnrichmentInput } from "@/workflows/videoEnrichment"

export type MastraVideoEnrichmentDispatchResult =
  | { ok: true; runId: string }
  | {
      ok: false
      reason:
        | "config_missing"
        | "auth_failed"
        | "network_error"
        | "rejected"
        | "invalid_response"
      status?: number
      message?: string
    }

type DispatchOptions = {
  baseUrl?: string
  bearer?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export async function dispatchMastraVideoEnrichment(
  input: VideoEnrichmentInput,
  options: DispatchOptions = {},
): Promise<MastraVideoEnrichmentDispatchResult> {
  const baseUrl = options.baseUrl ?? env.MASTRA_BASE_URL
  const bearer =
    options.bearer ??
    env.MASTRA_ENRICHMENT_API_KEY ??
    env.MASTRA_SERVICE_API_KEY
  const timeoutMs =
    options.timeoutMs ?? env.MASTRA_ENRICHMENT_DISPATCH_TIMEOUT_MS ?? 15_000
  const fetchImpl = options.fetchImpl ?? fetch

  if (!baseUrl || !bearer) {
    return { ok: false, reason: "config_missing" }
  }

  let response: Response
  try {
    response = await fetchImpl(new URL("/forge-video-enrichment", baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    return {
      ok: false,
      reason: "network_error",
      message: error instanceof Error ? error.message : undefined,
    }
  }

  if (response.status === 401) {
    return { ok: false, reason: "auth_failed", status: response.status }
  }
  if (!response.ok) {
    return { ok: false, reason: "rejected", status: response.status }
  }

  const body = (await response.json().catch(() => null)) as {
    ok?: unknown
    runId?: unknown
  } | null

  if (body?.ok === true && typeof body.runId === "string") {
    return { ok: true, runId: body.runId }
  }

  return { ok: false, reason: "invalid_response", status: response.status }
}
