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

const { defaultClientMock } = vi.hoisted(() => ({
  defaultClientMock: vi.fn(),
}))

vi.mock("@/cms/client", () => ({
  default: () => ({ query: defaultClientMock }),
}))

const { env } = await import("@/config/env")
const { __clearInFlightMapForTests } = await import("@/lib/admin-trigger-route")
const { POST } = await import("@/app/api/admin-trigger/transcript/route")

const envMutable = env as { ADMIN_TRIGGER_API_KEYS?: string }
const BEARER = "test-trigger-key-T"

beforeEach(() => {
  envMutable.ADMIN_TRIGGER_API_KEYS = BEARER
  __clearInFlightMapForTests()
  defaultClientMock.mockReset()
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
    defaultClientMock.mockResolvedValueOnce({
      data: {
        videos: [
          {
            documentId: "doc-A",
            coreId: "core-A",
            title: "T",
            label: "shortFilm",
            primaryLanguage: { coreId: "lang-en", bcp47: "en" },
            subtitles: [
              {
                primary: true,
                aiGenerated: false,
                vttSrc: "https://stream.mux.com/A.vtt",
                language: { coreId: "lang-en", bcp47: "en" },
              },
            ],
            variants: [
              {
                muxVideo: { assetId: "mux-A" },
                language: { coreId: "lang-en", bcp47: "en" },
              },
            ],
          },
        ],
      },
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
      languageCode: "en",
    })
  })
})
