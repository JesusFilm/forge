import { beforeEach, describe, expect, it, vi } from "vitest"
import { AdminGraphqlClient } from "./admin-client"

const fetchMock = vi.fn()

describe("AdminGraphqlClient", () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it("logs in through Admin GraphQL and normalizes the Manager session", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            managerLogin: {
              token: "better-auth.session_token=abc",
              user: {
                id: "42",
                username: "operator",
                email: "operator@example.test",
                role: "VIEWER",
                managerRole: "OPERATOR",
              },
            },
          },
        }),
      ),
    )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      apiKey: "manager-service-key",
      fetchImpl: fetchMock,
    })

    await expect(
      client.loginManagerUser("operator@example.test", "secret"),
    ).resolves.toEqual({
      token: "better-auth.session_token=abc",
      user: {
        id: 42,
        username: "operator",
        email: "operator@example.test",
        role: { name: "VIEWER", type: "viewer" },
        managerRole: "OPERATOR",
      },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://admin.example/api/graphql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer manager-service-key",
          "Content-Type": "application/json",
        }),
      }),
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      variables: {
        email: "operator@example.test",
        password: "secret",
      },
    })
  })

  it("does not normalize Admin users without Manager membership as Manager sessions", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            managerLogin: {
              token: "admin-session-token",
              user: {
                id: "42",
                username: "admin",
                email: "admin@example.test",
                role: "ADMIN",
              },
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
      client.loginManagerUser("admin@example.test", "secret"),
    ).resolves.toBeNull()
  })

  it("does not normalize malformed Admin role data as a Manager role", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            managerLogin: {
              token: "admin-session-token",
              user: {
                id: "42",
                username: "operator",
                email: "operator@example.test",
                managerRole: "OPERATOR",
              },
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
      client.loginManagerUser("operator@example.test", "secret"),
    ).resolves.toBeNull()
  })

  it("verifies Manager sessions through a Cookie header without GraphQL token variables", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            managerSession: {
              id: "42",
              username: "operator",
              email: "operator@example.test",
              role: "VIEWER",
              managerRole: "OPERATOR",
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
      client.verifyManagerSession("better-auth.session_token=abc"),
    ).resolves.toMatchObject({
      email: "operator@example.test",
      managerRole: "OPERATOR",
    })
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers).toMatchObject({
      Cookie: "better-auth.session_token=abc",
    })
    expect(JSON.parse(init.body)).toEqual({
      query: expect.stringContaining("query ManagerSession"),
      variables: {},
    })
  })

  it("revokes Manager sessions through a Cookie header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { managerLogout: true } })),
    )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      fetchImpl: fetchMock,
    })

    await expect(
      client.logoutManagerSession("better-auth.session_token=abc"),
    ).resolves.toBe(true)
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Cookie: "better-auth.session_token=abc",
    })
  })

  it("reads Manager video coverage from Admin without Strapi URL state", async () => {
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
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      variables: { languageIds: ["529"] },
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).query).toContain(
      "$languageIds: [String!]",
    )
    expect(fetchMock).toHaveBeenCalledWith(
      "https://admin.example/api/graphql",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer manager-service-key",
        }),
      }),
    )
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
