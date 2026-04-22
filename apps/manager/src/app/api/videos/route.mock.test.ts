import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_MOCK_CMS_SEED, cloneMockCmsSeed } from "@/cms/mock-seed"

const { authenticateRequestMock, getCmsGatewayMock } = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  getCmsGatewayMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/config/env", () => ({
  env: {
    STRAPI_URL: "http://example.test",
    STRAPI_API_TOKEN: "token",
  },
}))

vi.mock("@/cms/gateway", async () => {
  const actual =
    await vi.importActual<typeof import("@/cms/gateway")>("@/cms/gateway")
  return {
    ...actual,
    getCmsGateway: getCmsGatewayMock,
  }
})

import { GET } from "./route"

describe("GET /api/videos in mock mode", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    getCmsGatewayMock.mockReset()
    authenticateRequestMock.mockResolvedValue(null)
  })

  it("groups mock collections and standalone videos for the dashboard", async () => {
    const videos = cloneMockCmsSeed(
      DEFAULT_MOCK_CMS_SEED.readModels.videoCoverage,
    )

    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      getVideoCoverage: vi.fn(async () => videos),
    })

    const response = await GET(new Request("http://example.test/api/videos"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      collections: [
        {
          title: "Hope Stories",
          videos: [{ title: "Episode 1" }, { title: "Episode 2" }],
        },
      ],
      standalone: [{ title: "A New Beginning" }],
    })
  })
})
