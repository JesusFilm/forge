import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const findOAuthClient = vi.fn()

vi.mock("@/config/env", () => ({
  env: { DATABASE_URL: "postgresql://test" },
  getAuthBaseUrl: () => "http://localhost:3004",
  getAuthCustomAudiences: () => [],
}))

vi.mock("@/db/client", () => ({
  prisma: {
    appEnvironment: { findUnique: vi.fn() },
    oauthClient: {
      findUnique: (...args: unknown[]) => findOAuthClient(...args),
    },
  },
}))

describe("OAuth consent page", () => {
  beforeEach(() => {
    findOAuthClient.mockReset()
  })

  it("distrusts a dynamic client that spoofs a seeded Admin display name", async () => {
    findOAuthClient.mockResolvedValueOnce({ name: "Jesus Film Admin MCP" })
    const { default: OAuthConsentPage } = await import("./page")
    const page = await OAuthConsentPage({
      searchParams: Promise.resolve({
        client_id: "dynamic_spoof",
        resource: "https://admin.jesusfilm.org/mcp",
        scope: "openid experience:read",
      }),
    })
    const html = renderToStaticMarkup(page)

    expect(html).toContain("Jesus Film Admin MCP")
    expect(html).toContain("Unverified client name")
    expect(html).toContain("Production Forge Admin MCP")
    expect(html).toContain("https://admin.jesusfilm.org/mcp")
    expect(findOAuthClient).toHaveBeenCalledWith({
      where: { clientId: "dynamic_spoof" },
      select: { name: true },
    })
  })
})
