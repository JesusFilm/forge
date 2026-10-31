import { expect, test, vi } from "vitest"
import { studioOAuthScopes } from "@forge/studio-contracts/agent"
import { GET } from "./route"

vi.mock("@/config/env", () => ({
  env: { AUTH_ISSUER_URL: "https://auth.example.test/api/auth" },
}))
vi.mock("@/services/studio-agent/oauth", () => ({
  studioMcpAudience: () => "https://shorts.example.test/mcp",
}))

test("advertises renewal separately from the unchanged Shorts tool scopes", async () => {
  await expect(GET().json()).resolves.toMatchObject({
    resource: "https://shorts.example.test/mcp",
    authorization_servers: ["https://auth.example.test/api/auth"],
    scopes_supported: ["offline_access", ...studioOAuthScopes],
  })
  expect(studioOAuthScopes).not.toContain("offline_access")
})
