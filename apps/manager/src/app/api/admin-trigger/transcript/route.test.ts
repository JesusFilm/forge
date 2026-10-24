import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Wiring test for the transcript trigger route. See
// admin-trigger-route.test.ts for the exhaustive shared-helper
// coverage (auth, validation, idempotency, not_found, etc.).

vi.mock("@/config/env", () => ({
  env: {} as { ADMIN_TRIGGER_API_KEYS?: string },
}))

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server")
  return {
    ...actual,
    after: (cb: () => unknown | Promise<unknown>) => {
      void Promise.resolve().then(cb)
    },
  }
})

const { runTranscriptOnlyPipelineMock } = vi.hoisted(() => ({
  runTranscriptOnlyPipelineMock: vi.fn(),
}))

vi.mock("@/workflows/transcriptOnlyPipeline", () => ({
  runTranscriptOnlyPipeline: runTranscriptOnlyPipelineMock,
}))

const { adminLookupMock } = vi.hoisted(() => ({
  adminLookupMock: vi.fn(),
}))

vi.mock("@/lib/admin-video-lookup", () => ({
  lookupVideosByCoreIdFromAdmin: adminLookupMock,
  videoLookupKey: (coreId: string, targetLocale?: string | null) =>
    targetLocale ? `${coreId}::${targetLocale}` : coreId,
}))

const { env } = await import("@/config/env")
const { __clearInFlightMapForTests } = await import("@/lib/admin-trigger-route")
const { POST } = await import("@/app/api/admin-trigger/transcript/route")

const envMutable = env as { ADMIN_TRIGGER_API_KEYS?: string }
const BEARER = "test-trigger-key-T"

beforeEach(() => {
  envMutable.ADMIN_TRIGGER_API_KEYS = BEARER
  __clearInFlightMapForTests()
  adminLookupMock.mockReset()
  runTranscriptOnlyPipelineMock.mockReset()
  runTranscriptOnlyPipelineMock.mockResolvedValue({
    assetId: "1",
    language: "en",
    totalChunks: 0,
    totalTokens: 0,
    embeddingDimensions: 1536,
  })
})

afterEach(() => {
  envMutable.ADMIN_TRIGGER_API_KEYS = undefined
})

describe("POST /api/admin-trigger/transcript", () => {
  it("dispatches runTranscriptOnlyPipeline with stringified assetId + bcp47", async () => {
    adminLookupMock.mockResolvedValueOnce({
      ok: true,
      data: new Map([
        [
          "core-A",
          {
            id: "v-A",
            coreId: "core-A",
            label: "shortFilm",
            primaryLanguageBcp47: "en",
            muxAssetId: "mux-A",
            subtitleUrl: "https://stream.mux.com/A.vtt",
          },
        ],
      ]),
    })

    const req = new Request(
      "http://example.test/api/admin-trigger/transcript",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ items: [{ assetId: 99, coreId: "core-A" }] }),
      },
    )
    const res = await POST(req)
    expect(res.status).toBe(200)

    await new Promise((r) => setTimeout(r, 0))

    expect(runTranscriptOnlyPipelineMock).toHaveBeenCalledOnce()
    expect(runTranscriptOnlyPipelineMock).toHaveBeenCalledWith({
      assetId: "99",
      muxAssetId: "mux-A",
      adminVideoId: "v-A",
      subtitleUrl: "https://stream.mux.com/A.vtt",
      languageCode: "en",
    })
  })

  it("does not require subtitleUrl for transcript-only dispatch", async () => {
    adminLookupMock.mockResolvedValueOnce({
      ok: true,
      data: new Map([
        [
          "core-A",
          {
            id: "v-A",
            coreId: "core-A",
            label: "shortFilm",
            primaryLanguageBcp47: "en",
            muxAssetId: "mux-A",
            subtitleUrl: null,
          },
        ],
      ]),
    })

    const req = new Request(
      "http://example.test/api/admin-trigger/transcript",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ items: [{ assetId: 99, coreId: "core-A" }] }),
      },
    )
    const res = await POST(req)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      results: [{ assetId: 99, status: "started" }],
    })

    await new Promise((r) => setTimeout(r, 0))

    expect(runTranscriptOnlyPipelineMock).toHaveBeenCalledWith({
      assetId: "99",
      muxAssetId: "mux-A",
      adminVideoId: "v-A",
      subtitleUrl: undefined,
      languageCode: "en",
    })
  })
})
