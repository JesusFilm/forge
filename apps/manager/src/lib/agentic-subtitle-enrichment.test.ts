import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as {
    AGENTIC_BASE_URL?: string
    AGENTIC_SERVICE_API_KEY?: string
    AGENTIC_REQUEST_TIMEOUT_MS?: number
  },
}))

const { env } = await import("@/config/env")
const { triggerAgenticSubtitleEnrichment } =
  await import("@/lib/agentic-subtitle-enrichment")

const envMutable = env as {
  AGENTIC_BASE_URL?: string
  AGENTIC_SERVICE_API_KEY?: string
  AGENTIC_REQUEST_TIMEOUT_MS?: number
}

const fetchSpy = vi.spyOn(globalThis, "fetch")

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("agentic-subtitle-enrichment", () => {
  beforeEach(() => {
    envMutable.AGENTIC_BASE_URL = "https://agentic.example"
    envMutable.AGENTIC_SERVICE_API_KEY = "service-key"
    envMutable.AGENTIC_REQUEST_TIMEOUT_MS = 2500
    fetchSpy.mockReset()
  })

  afterEach(() => {
    envMutable.AGENTIC_BASE_URL = undefined
    envMutable.AGENTIC_SERVICE_API_KEY = undefined
    envMutable.AGENTIC_REQUEST_TIMEOUT_MS = undefined
  })

  it("posts subtitle enrichment runs to Agentic with service auth", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        agenticRunId: "agentic-run-1",
        managerJobId: "job-1",
        status: "queued",
        summary: "Subtitle enrichment queued.",
      }),
    )

    const result = await triggerAgenticSubtitleEnrichment({
      jobId: "job-1",
      assetId: "mux-target-1",
      muxAssetId: "mux-target-1",
      muxPlaybackId: "mux-playback-1",
      sourceLanguage: "en",
      targetLanguage: "fr",
      requestedTranscriptionProvider: "automatic",
      idempotencyKey: "manager:subtitle-enrichment:job-1",
    })

    expect(result).toEqual({
      ok: true,
      agenticRunId: "agentic-run-1",
      managerJobId: "job-1",
      status: "queued",
      summary: "Subtitle enrichment queued.",
    })
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe("https://agentic.example/forge/subtitle-enrichment-runs")
    expect(init?.method).toBe("POST")
    expect(init?.headers).toMatchObject({
      authorization: "Bearer service-key",
      "content-type": "application/json",
    })
    expect(JSON.parse(init?.body as string)).toEqual({
      jobId: "job-1",
      assetId: "mux-target-1",
      muxAssetId: "mux-target-1",
      muxPlaybackId: "mux-playback-1",
      sourceLanguage: "en",
      targetLanguage: "fr",
      requestedTranscriptionProvider: "automatic",
      idempotencyKey: "manager:subtitle-enrichment:job-1",
    })
  })

  it("fails closed when Agentic env is not configured", async () => {
    envMutable.AGENTIC_BASE_URL = undefined

    const result = await triggerAgenticSubtitleEnrichment({
      jobId: "job-1",
      assetId: "mux-target-1",
      muxAssetId: "mux-target-1",
      muxPlaybackId: "mux-playback-1",
      sourceLanguage: "en",
      targetLanguage: "fr",
      requestedTranscriptionProvider: "automatic",
      idempotencyKey: "test",
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("config_missing")
    expect(result.retryable).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("returns contract_error for unexpected Agentic responses", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true, data: {} }))

    const result = await triggerAgenticSubtitleEnrichment({
      jobId: "job-1",
      assetId: "mux-target-1",
      muxAssetId: "mux-target-1",
      muxPlaybackId: "mux-playback-1",
      sourceLanguage: "en",
      targetLanguage: "fr",
      requestedTranscriptionProvider: "automatic",
      idempotencyKey: "test",
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("contract_error")
    expect(result.retryable).toBe(false)
  })
})
