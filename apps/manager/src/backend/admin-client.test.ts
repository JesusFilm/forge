import { beforeEach, describe, expect, it, vi } from "vitest"
import { AdminGraphqlClient } from "./admin-client"

const fetchMock = vi.fn()

describe("AdminGraphqlClient", () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it("reads Manager video coverage from Admin with the service bearer", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            managerVideoCoverage: [
              {
                documentId: "video-doc-1",
                coreId: "core-1",
                title: "Episode 1",
                label: "episode",
                slug: "episode-1",
                aiMetadata: false,
                imageUrl: null,
                parentDocumentIds: ["collection-doc-1"],
                coverage: {
                  subtitles: { human: 1, ai: 0 },
                  audio: { human: 0, ai: 1 },
                },
              },
            ],
          },
        }),
      ),
    )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      apiKey: "manager-service-key",
      fetchImpl: fetchMock,
    })

    await expect(client.getVideoCoverage(["529"])).resolves.toEqual([
      expect.objectContaining({
        documentId: "video-doc-1",
        coverage: {
          subtitles: { human: 1, ai: 0 },
          audio: { human: 0, ai: 1 },
        },
      }),
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      "https://admin.example/api/graphql",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer manager-service-key",
          "Content-Type": "application/json",
        }),
      }),
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      variables: { languageIds: ["529"] },
    })
  })

  it("surfaces Admin GraphQL failures as transport errors", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [{ message: "access denied" }],
        }),
      ),
    )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      fetchImpl: fetchMock,
    })

    await expect(client.getLanguageGeo()).rejects.toThrow("access denied")
  })

  it("creates Manager jobs through the Admin job contract", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            createManagerJob: {
              id: "admin-job-1",
              muxAssetId: "asset-1",
              muxPlaybackId: "playback-1",
              videoDocumentId: "video-doc-1",
              languages: ["529"],
              options: {},
              status: "pending",
              retries: 0,
              createdAt: "2026-05-06T00:00:00.000Z",
              updatedAt: "2026-05-06T00:00:00.000Z",
              artifacts: {},
              steps: [],
              errors: [],
            },
          },
        }),
      ),
    )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      fetchImpl: fetchMock,
    })

    await expect(
      client.createJob({
        muxAssetId: "asset-1",
        muxPlaybackId: "playback-1",
        videoDocumentId: "video-doc-1",
        languages: ["529"],
        steps: [],
      }),
    ).resolves.toMatchObject({
      id: "admin-job-1",
      videoDocumentId: "video-doc-1",
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      variables: {
        muxAssetId: "asset-1",
        muxPlaybackId: "playback-1",
        videoDocumentId: "video-doc-1",
      },
    })
  })
})
