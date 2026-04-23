import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_MOCK_CMS_SEED, cloneMockCmsSeed } from "@/cms/mock-seed"

const { authenticateRequestMock, getCmsGatewayMock, getVideoCoverageMock } =
  vi.hoisted(() => ({
    authenticateRequestMock: vi.fn(),
    getCmsGatewayMock: vi.fn(),
    getVideoCoverageMock: vi.fn(),
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
    getVideoCoverageMock.mockReset()
    authenticateRequestMock.mockResolvedValue(null)
  })

  it("groups mock collections and standalone videos for the dashboard", async () => {
    const videos = cloneMockCmsSeed(
      DEFAULT_MOCK_CMS_SEED.readModels.videoCoverage,
    )

    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      getVideoCoverage: getVideoCoverageMock.mockResolvedValue(videos),
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

  it("passes selected language ids to the mock coverage gateway", async () => {
    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      getVideoCoverage: getVideoCoverageMock.mockImplementation(
        async (languageIds?: string[]) =>
          languageIds?.includes("6414")
            ? [
                {
                  ...DEFAULT_MOCK_CMS_SEED.readModels.videoCoverage[3],
                  coverage: {
                    subtitles: { human: 0, ai: 1 },
                    audio: { human: 0, ai: 0 },
                  },
                },
              ]
            : [
                {
                  ...DEFAULT_MOCK_CMS_SEED.readModels.videoCoverage[3],
                  coverage: {
                    subtitles: { human: 1, ai: 0 },
                    audio: { human: 0, ai: 0 },
                  },
                },
              ],
      ),
    })

    const englishResponse = await GET(
      new Request("http://example.test/api/videos?languageIds=529"),
    )
    const frenchResponse = await GET(
      new Request("http://example.test/api/videos?languageIds=6414"),
    )

    expect(getVideoCoverageMock).toHaveBeenNthCalledWith(1, ["529"])
    expect(getVideoCoverageMock).toHaveBeenNthCalledWith(2, ["6414"])
    await expect(englishResponse.json()).resolves.not.toEqual(
      await frenchResponse.json(),
    )
  })
})
