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

describe("GET /api/languages", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    getCmsGatewayMock.mockReset()
    authenticateRequestMock.mockResolvedValue(null)
  })

  it("serves mock language geo data without reaching Strapi", async () => {
    const languageGeo = cloneMockCmsSeed(
      DEFAULT_MOCK_CMS_SEED.readModels.languageGeo,
    )

    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      getLanguageGeo: vi.fn(async () => languageGeo),
    })

    const response = await GET(new Request("http://example.test/api/languages"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(languageGeo)
  })
})
