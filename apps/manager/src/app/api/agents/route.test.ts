import { beforeEach, describe, expect, it, vi } from "vitest"

const { authenticateRequestMock, listSharedAgentCatalogMock } = vi.hoisted(
  () => ({
    authenticateRequestMock: vi.fn(),
    listSharedAgentCatalogMock: vi.fn(),
  }),
)

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/features/agents/shared-agent-runtime", () => ({
  listSharedAgentCatalog: listSharedAgentCatalogMock,
}))

import { GET } from "@/app/api/agents/route"

describe("GET /api/agents", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    listSharedAgentCatalogMock.mockReset()
    authenticateRequestMock.mockResolvedValue(null)
  })

  it("lists shared agents for authenticated Manager callers", async () => {
    listSharedAgentCatalogMock.mockReturnValue([
      { id: "translation", name: "Translation Agent" },
    ])

    const response = await GET(new Request("http://example.test/api/agents"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      agents: [{ id: "translation", name: "Translation Agent" }],
    })
  })

  it("returns the authentication error when the caller is not allowed", async () => {
    authenticateRequestMock.mockResolvedValue(
      new Response("nope", { status: 401 }),
    )

    const response = await GET(new Request("http://example.test/api/agents"))

    expect(response.status).toBe(401)
    expect(listSharedAgentCatalogMock).not.toHaveBeenCalled()
  })
})
