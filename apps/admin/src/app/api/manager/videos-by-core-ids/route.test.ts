import { beforeEach, describe, expect, it, vi } from "vitest"

const isValidWorkflowBearerMock = vi.fn()
const getByCoreIdsMock = vi.fn()

vi.mock("@/auth/workflow-bearer", () => ({
  isValidWorkflowBearer: isValidWorkflowBearerMock,
}))

vi.mock("@/db/client", () => ({
  prisma: {},
}))

vi.mock("@/services", () => ({
  createServices: () => ({
    video: {
      getByCoreIds: getByCoreIdsMock,
    },
  }),
}))

const { POST, GET } = await import("./route")

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://admin.test/api/manager/videos-by-core-ids", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe("POST /api/manager/videos-by-core-ids", () => {
  beforeEach(() => {
    isValidWorkflowBearerMock.mockReset()
    getByCoreIdsMock.mockReset()
    isValidWorkflowBearerMock.mockReturnValue(true)
    getByCoreIdsMock.mockResolvedValue([
      {
        id: "v-1",
        coreId: "core-1",
        label: "featureFilm",
        primaryLanguageBcp47: "en",
        muxAssetId: "mux-1",
        subtitleUrl: "https://example.test/subtitles.vtt",
      },
    ])
  })

  it("returns dispatch fields for a valid workflow bearer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const response = await POST(
      request(
        { coreIds: ["core-1"] },
        { authorization: "Bearer workflow-key" },
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      videos: [
        {
          id: "v-1",
          coreId: "core-1",
          label: "featureFilm",
          primaryLanguageBcp47: "en",
          muxAssetId: "mux-1",
          subtitleUrl: "https://example.test/subtitles.vtt",
        },
      ],
    })
    expect(isValidWorkflowBearerMock).toHaveBeenCalledWith(
      "Bearer workflow-key",
    )
    expect(getByCoreIdsMock).toHaveBeenCalledWith({ coreIds: ["core-1"] })
    expect(warn.mock.calls[0][0]).toContain("event=rest_lookup.complete")
    expect(warn.mock.calls[0][0]).not.toContain("workflow-key")
    warn.mockRestore()
  })

  it("rejects missing or invalid bearer without invoking the service", async () => {
    isValidWorkflowBearerMock.mockReturnValue(false)

    const response = await POST(request({ coreIds: ["core-1"] }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: "Authorization required",
    })
    expect(getByCoreIdsMock).not.toHaveBeenCalled()
  })

  it("rejects malformed coreIds before invoking the service", async () => {
    const response = await POST(request({ coreIds: ["core-1", 2] }))

    expect(response.status).toBe(400)
    expect(getByCoreIdsMock).not.toHaveBeenCalled()
  })

  it("rejects more than 100 coreIds before invoking the service", async () => {
    const response = await POST(
      request({
        coreIds: Array.from({ length: 101 }, (_, i) => `core-${i}`),
      }),
    )

    expect(response.status).toBe(400)
    expect(getByCoreIdsMock).not.toHaveBeenCalled()
  })

  it("returns a typed 502 envelope on service failure without leaking the error message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    getByCoreIdsMock.mockRejectedValueOnce(new Error("secret failure detail"))

    const response = await POST(request({ coreIds: ["core-1"] }))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: "Lookup failed",
      reason: "lookup_failed",
      retryable: true,
    })
    expect(warn.mock.calls[0][0]).toContain("event=rest_lookup.failed")
    expect(warn.mock.calls[0][0]).toContain("errorName=Error")
    expect(warn.mock.calls[0][0]).not.toContain("secret failure detail")
    expect(warn.mock.calls[0][0]).not.toContain("core-1")
    warn.mockRestore()
  })

  it("GET returns 401", async () => {
    const response = await GET()

    expect(response.status).toBe(401)
  })
})
