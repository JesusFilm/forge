import { describe, expect, it, vi } from "vitest"

const { serviceBearerMock, oauthBearerMock } = vi.hoisted(() => ({
  serviceBearerMock: vi.fn(async () => "fresh-oauth-backend-token"),
  oauthBearerMock: vi.fn(async () => "fresh-oauth-session-token"),
}))

vi.mock("@/config/env", () => ({
  env: {
    ADMIN_GRAPHQL_URL: "https://admin.example/api/graphql",
    ADMIN_MANAGER_API_KEY: undefined,
  },
}))
vi.mock("@/lib/admin-manager-session", () => ({
  getAdminManagerServiceBearer: serviceBearerMock,
  getAdminManagerOAuthBearer: oauthBearerMock,
}))
vi.mock("@/lib/subtitle-eval-session-proof", () => ({
  createSubtitleEvalSessionProof: vi.fn(),
}))

import { SubtitleLabAdminClient } from "./subtitle-lab-admin-client"

describe("configured Subtitle Lab Admin client", () => {
  it("uses fresh OAuth for GraphQL without a permanent Admin API key", async () => {
    const fetchMock = vi.fn(
      async (_url: URL | RequestInfo, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            data: {
              claimManagerSubtitleEvalCell: {
                id: "cell-1",
                status: "RUNNING",
                digest: "1:fence:2026-08-20T12:00:00.000Z",
                replayed: false,
              },
            },
          }),
        ),
    )
    const client = await SubtitleLabAdminClient.configured(
      fetchMock as typeof fetch,
    )

    await expect(client.claimCell("cell-1", 60)).resolves.toMatchObject({
      status: "RUNNING",
    })
    expect(serviceBearerMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer fresh-oauth-backend-token",
      }),
    )
  })
})
