import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Validate the route file wires runSceneAnalysisPipeline correctly
// and forwards through processAdminTriggerRequest. The shared
// helper's behavior is exhaustively tested in
// admin-trigger-route.test.ts; this test focuses on the wiring +
// payload mapping (videoId/assetId stringification, label passthrough).

vi.mock("@/config/env", () => ({
  env: {} as { ADMIN_TRIGGER_API_KEYS?: string },
}))

// Stub next/server's `after` (which throws outside a request context)
// while preserving the real `NextResponse` constructor for response
// shaping. The real after() wires into Next's request lifecycle; this
// test exercises the handler in isolation.
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

const { runSceneAnalysisPipelineMock } = vi.hoisted(() => ({
  runSceneAnalysisPipelineMock: vi.fn(),
}))

vi.mock("@/workflows/sceneAnalysisPipeline", () => ({
  runSceneAnalysisPipeline: runSceneAnalysisPipelineMock,
}))

const { defaultClientMock } = vi.hoisted(() => ({
  defaultClientMock: vi.fn(),
}))

vi.mock("@/cms/client", () => ({
  default: () => ({ query: defaultClientMock }),
}))

const { env } = await import("@/config/env")
const { __clearInFlightMapForTests } = await import("@/lib/admin-trigger-route")
const { POST } = await import("@/app/api/admin-trigger/scene-analysis/route")

const envMutable = env as { ADMIN_TRIGGER_API_KEYS?: string }
const BEARER = "test-trigger-key-XYZ"

beforeEach(() => {
  envMutable.ADMIN_TRIGGER_API_KEYS = BEARER
  __clearInFlightMapForTests()
  defaultClientMock.mockReset()
  runSceneAnalysisPipelineMock.mockReset()
  runSceneAnalysisPipelineMock.mockResolvedValue({
    videoId: 1,
    assetId: "1",
    sceneCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  })
})

afterEach(() => {
  envMutable.ADMIN_TRIGGER_API_KEYS = undefined
})

describe("POST /api/admin-trigger/scene-analysis", () => {
  it("dispatches runSceneAnalysisPipeline with the resolved fields", async () => {
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
      "http://example.test/api/admin-trigger/scene-analysis",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          items: [{ assetId: 42, coreId: "core-A" }],
        }),
      },
    )
    const res = await POST(req)
    expect(res.status).toBe(200)

    // Allow background dispatch (next/server.after is not running in
    // the route's test, so the route handler invokes after() with a
    // queued microtask in real Next runtime; here we just give the
    // event loop a tick to be safe).
    await new Promise((r) => setTimeout(r, 0))

    expect(runSceneAnalysisPipelineMock).toHaveBeenCalledOnce()
    expect(runSceneAnalysisPipelineMock).toHaveBeenCalledWith({
      videoId: 42,
      assetId: "42",
      muxAssetId: "mux-A",
      subtitleUrl: "https://stream.mux.com/A.vtt",
      videoLabel: "shortFilm",
    })
  })

  it("returns 503 on missing ADMIN_TRIGGER_API_KEYS without invoking dispatch", async () => {
    envMutable.ADMIN_TRIGGER_API_KEYS = undefined
    const req = new Request(
      "http://example.test/api/admin-trigger/scene-analysis",
      {
        method: "POST",
        headers: { authorization: `Bearer ${BEARER}` },
        body: JSON.stringify({ items: [{ assetId: 1, coreId: "x" }] }),
      },
    )
    const res = await POST(req)
    expect(res.status).toBe(503)
    expect(runSceneAnalysisPipelineMock).not.toHaveBeenCalled()
    expect(defaultClientMock).not.toHaveBeenCalled()
  })
})
