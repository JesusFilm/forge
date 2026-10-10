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
  env: {},
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
          coreId: "collection-1",
          slug: "hope-stories",
          title: "Hope Stories",
          videos: [
            {
              coreId: "ep-1",
              slug: "hope-stories-episode-1",
              title: "Episode 1",
            },
            {
              coreId: "ep-2",
              slug: "hope-stories-episode-2",
              title: "Episode 2",
            },
          ],
        },
      ],
      standalone: [
        {
          coreId: "standalone-1",
          slug: "a-new-beginning",
          title: "A New Beginning",
        },
      ],
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

  it("orders collection children by their parent relation order", async () => {
    const seed = cloneMockCmsSeed(
      DEFAULT_MOCK_CMS_SEED.readModels.videoCoverage,
    )
    const collection = seed[0]
    const episodeOne = seed[1]
    const episodeTwo = seed[2]

    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      getVideoCoverage: getVideoCoverageMock.mockResolvedValue([
        collection,
        {
          ...episodeTwo,
          parentRelations: [
            { parentDocumentId: collection.documentId, order: 2 },
          ],
        },
        {
          ...episodeOne,
          parentRelations: [
            { parentDocumentId: collection.documentId, order: 1 },
          ],
        },
      ]),
    })

    const response = await GET(new Request("http://example.test/api/videos"))

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(
      payload.collections[0].videos.map(
        (video: { coreId: string }) => video.coreId,
      ),
    ).toEqual(["ep-1", "ep-2"])
  })

  it("falls back to the slug when Admin omits a preferred localized title", async () => {
    const standalone = DEFAULT_MOCK_CMS_SEED.readModels.videoCoverage[3]

    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      getVideoCoverage: getVideoCoverageMock.mockResolvedValue([
        {
          ...standalone,
          title: null,
          slug: "stable-video-slug",
        },
      ]),
    })

    const response = await GET(
      new Request("http://example.test/api/videos?languageIds=slug-fallback"),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      standalone: [{ slug: "stable-video-slug", title: "stable-video-slug" }],
    })
  })
})
