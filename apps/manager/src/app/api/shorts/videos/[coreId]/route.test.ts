import { beforeEach, describe, expect, it, vi } from "vitest"

const { authenticateRequestMock, lookupVideosMock, getMuxAssetPlaybackMock } =
  vi.hoisted(() => ({
    authenticateRequestMock: vi.fn(),
    lookupVideosMock: vi.fn(),
    getMuxAssetPlaybackMock: vi.fn(),
  }))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/lib/admin-video-lookup", () => ({
  lookupVideosByCoreIdFromAdmin: lookupVideosMock,
}))

vi.mock("@/services/mux", () => ({
  getMuxAssetPlayback: getMuxAssetPlaybackMock,
}))

const { GET } = await import("@/app/api/shorts/videos/[coreId]/route")

function adminVideo(overrides: Record<string, unknown> = {}) {
  return {
    id: "video-1",
    coreId: "1_jf-0-0",
    label: "JESUS",
    primaryLanguageBcp47: "en",
    muxAssetId: "mux-1",
    subtitleUrl: null,
    ...overrides,
  }
}

function getRequest(): Request {
  return new Request("http://example.test/api/shorts/videos/1_jf-0-0")
}

const routeParams = { params: Promise.resolve({ coreId: "1_jf-0-0" }) }

beforeEach(() => {
  authenticateRequestMock.mockReset()
  lookupVideosMock.mockReset()
  getMuxAssetPlaybackMock.mockReset()

  authenticateRequestMock.mockResolvedValue(null)
  lookupVideosMock.mockResolvedValue({
    ok: true,
    data: new Map([["1_jf-0-0", adminVideo()]]),
  })
  getMuxAssetPlaybackMock.mockResolvedValue({
    assetId: "mux-1",
    status: "ready",
    duration: 7200.5,
    publicPlaybackId: "pbpublic",
  })
})

describe("GET /api/shorts/videos/[coreId]", () => {
  it("rejects unauthorized callers", async () => {
    authenticateRequestMock.mockResolvedValue(
      Response.json({ error: "Authentication required" }, { status: 401 }),
    )

    const response = await GET(getRequest(), routeParams)
    expect(response.status).toBe(401)
  })

  it("rejects malformed coreIds before any lookup", async () => {
    const response = await GET(getRequest(), {
      params: Promise.resolve({ coreId: "core%2F..%2Fevil" }),
    })
    expect(response.status).toBe(400)
    expect(lookupVideosMock).not.toHaveBeenCalled()
  })

  it("returns 404 video_not_found for unknown coreIds", async () => {
    lookupVideosMock.mockResolvedValue({ ok: true, data: new Map() })

    const response = await GET(getRequest(), routeParams)
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      reason: "video_not_found",
    })
  })

  it("maps lookup config_missing to 503 and transport failures to 502", async () => {
    lookupVideosMock.mockResolvedValue({
      ok: false,
      reason: "config_missing",
      messages: ["ADMIN_GRAPHQL_URL unset"],
      retryable: false,
    })
    expect((await GET(getRequest(), routeParams)).status).toBe(503)

    lookupVideosMock.mockResolvedValue({
      ok: false,
      reason: "network_error",
      messages: ["timeout"],
      retryable: true,
    })
    const unreachable = await GET(getRequest(), routeParams)
    expect(unreachable.status).toBe(502)
    await expect(unreachable.json()).resolves.toMatchObject({
      reason: "admin_unreachable",
    })
  })

  it("returns ineligible missing_mux_asset without calling Mux", async () => {
    lookupVideosMock.mockResolvedValue({
      ok: true,
      data: new Map([["1_jf-0-0", adminVideo({ muxAssetId: null })]]),
    })

    const response = await GET(getRequest(), routeParams)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      coreId: "1_jf-0-0",
      title: "JESUS",
      muxAssetId: null,
      playbackId: null,
      durationSec: null,
      language: { bcp47: "en", whisper: "en" },
      eligible: false,
      reason: "missing_mux_asset",
    })
    expect(getMuxAssetPlaybackMock).not.toHaveBeenCalled()
  })

  it("returns ineligible playback_not_public for signed/drm-only assets", async () => {
    getMuxAssetPlaybackMock.mockResolvedValue({
      assetId: "mux-1",
      status: "ready",
      duration: 7200.5,
      publicPlaybackId: null,
    })

    const response = await GET(getRequest(), routeParams)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      playbackId: null,
      durationSec: 7200.5,
      eligible: false,
      reason: "playback_not_public",
    })
  })

  it("returns an eligible resolution with the whisper-mapped language", async () => {
    lookupVideosMock.mockResolvedValue({
      ok: true,
      data: new Map([
        ["1_jf-0-0", adminVideo({ primaryLanguageBcp47: "pt-BR" })],
      ]),
    })

    const response = await GET(getRequest(), routeParams)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      coreId: "1_jf-0-0",
      title: "JESUS",
      muxAssetId: "mux-1",
      playbackId: "pbpublic",
      durationSec: 7200.5,
      language: { bcp47: "pt-BR", whisper: "pt" },
      eligible: true,
      reason: null,
    })
  })

  it("keeps whisper null for unsupported languages (still eligible)", async () => {
    lookupVideosMock.mockResolvedValue({
      ok: true,
      data: new Map([
        ["1_jf-0-0", adminVideo({ primaryLanguageBcp47: "xx-unknown" })],
      ]),
    })

    const response = await GET(getRequest(), routeParams)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      language: { bcp47: "xx-unknown", whisper: null },
      eligible: true,
    })
  })

  it("returns 502 mux_error when the Mux lookup fails", async () => {
    getMuxAssetPlaybackMock.mockRejectedValue(new Error("mux down"))

    const response = await GET(getRequest(), routeParams)
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      reason: "mux_error",
      retryable: true,
    })
  })
})
