import { beforeEach, describe, expect, it, vi } from "vitest"

const { authenticateRequestMock, getCmsGatewayMock, lookupVideosMock } =
  vi.hoisted(() => ({
    authenticateRequestMock: vi.fn(),
    getCmsGatewayMock: vi.fn(),
    lookupVideosMock: vi.fn(),
  }))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/lib/admin-video-lookup", () => ({
  lookupVideosByCoreIdFromAdmin: lookupVideosMock,
}))

vi.mock("@/cms/gateway", () => ({
  getCmsGateway: getCmsGatewayMock,
}))

const { GET } = await import("@/app/api/smart-crop/videos/[coreId]/route")

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
  return new Request("http://example.test/api/smart-crop/videos/1_jf-0-0")
}

const routeParams = { params: Promise.resolve({ coreId: "1_jf-0-0" }) }

beforeEach(() => {
  authenticateRequestMock.mockReset()
  getCmsGatewayMock.mockReset()
  lookupVideosMock.mockReset()

  authenticateRequestMock.mockResolvedValue(null)
  getCmsGatewayMock.mockImplementation(() => {
    throw new Error("mock gateway not configured")
  })
  lookupVideosMock.mockResolvedValue({
    ok: true,
    data: new Map([["1_jf-0-0", adminVideo()]]),
  })
})

describe("GET /api/smart-crop/videos/[coreId]", () => {
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

  it("returns ineligible missing_mux_asset without requiring manual entry", async () => {
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
      eligible: false,
      reason: "missing_mux_asset",
    })
  })

  it("uses mock Manager state when admin lookup is unconfigured in mock mode", async () => {
    lookupVideosMock.mockResolvedValue({
      ok: false,
      reason: "config_missing",
      messages: ["ADMIN_GRAPHQL_URL unset"],
      retryable: false,
    })
    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      readMockState: vi.fn(async () => ({
        readModels: {
          videoCoverage: [
            {
              documentId: "video-doc-standalone-1",
              coreId: "1_jf-0-0",
              title: "A New Beginning",
              slug: "a-new-beginning",
            },
          ],
          jobs: [
            {
              videoDocumentId: "video-doc-standalone-1",
              muxAssetId: "mock_asset_2",
            },
          ],
        },
      })),
    })

    const response = await GET(getRequest(), routeParams)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      coreId: "1_jf-0-0",
      title: "A New Beginning",
      muxAssetId: "mock_asset_2",
      eligible: true,
      reason: null,
    })
  })

  it("does not fill invalid admin Mux asset IDs", async () => {
    lookupVideosMock.mockResolvedValue({
      ok: true,
      data: new Map([["1_jf-0-0", adminVideo({ muxAssetId: "mux/evil" })]]),
    })

    const response = await GET(getRequest(), routeParams)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      coreId: "1_jf-0-0",
      title: "JESUS",
      muxAssetId: null,
      eligible: false,
      reason: "invalid_mux_asset",
    })
  })

  it("returns an eligible Mux asset resolution", async () => {
    const response = await GET(getRequest(), routeParams)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      coreId: "1_jf-0-0",
      title: "JESUS",
      muxAssetId: "mux-1",
      eligible: true,
      reason: null,
    })
  })
})
