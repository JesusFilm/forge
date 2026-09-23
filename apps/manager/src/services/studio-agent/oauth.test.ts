import { beforeEach, expect, it, vi } from "vitest"
import { generateKeyPair, SignJWT } from "jose"
import { authenticateStudioMcp } from "./oauth"
import { validateAdminManagerSession } from "@/lib/admin-manager-session"
const keys = await generateKeyPair("RS256")
vi.mock("jose", async (original) => ({
  ...(await original<typeof import("jose")>()),
  createRemoteJWKSet: () => async () => keys.publicKey,
}))
vi.mock("@/config/env", () => ({
  env: {
    AUTH_ISSUER_URL: "https://auth.example.test",
    STUDIO_MCP_AUDIENCE: "https://studio.example.test/mcp",
    STUDIO_ENVIRONMENT: "test",
    STUDIO_MCP_CLIENT_IDS: "claude,codex",
  },
}))
vi.mock("@/lib/admin-manager-session", () => ({
  validateAdminManagerSession: vi.fn(),
}))
beforeEach(() => {
  vi.mocked(validateAdminManagerSession).mockResolvedValue({
    user: { id: "operator", email: "operator@example.test" },
    managerRole: "OPERATOR",
    reviewerLanguageGrants: [],
  })
})
async function request(overrides: Record<string, unknown> = {}) {
  const token = await new SignJWT({
    sub: "auth-user",
    client_id: "codex",
    scope: "shorts:read shorts:edit",
    "https://jesusfilm.org/claims/app": "shorts-mcp",
    "https://jesusfilm.org/claims/environment": "test",
    iss: "https://auth.example.test",
    aud: "https://studio.example.test/mcp",
    exp: Math.floor(Date.now() / 1000) + 60,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256" })
    .sign(keys.privateKey)
  return new Request("https://studio.example.test/mcp", {
    headers: { authorization: `Bearer ${token}` },
  })
}
it("binds real verified JWT identity to the current operator and client", async () => {
  expect(await authenticateStudioMcp(await request(), "shorts:edit")).toEqual({
    sub: "operator",
    authority: "delegated",
    clientId: "codex",
    scopes: ["shorts:read", "shorts:edit"],
  })
})
it("rejects insufficient consent, wrong environment/audience/client and expired credentials", async () => {
  for (const claims of [
    { scope: "shorts:read" },
    { "https://jesusfilm.org/claims/environment": "production" },
    { aud: "another-resource" },
    { client_id: "unapproved" },
    { exp: 1 },
  ]) {
    await expect(
      authenticateStudioMcp(await request(claims), "shorts:edit"),
    ).rejects.toThrow()
  }
})
it("revalidates membership and rejects reviewers as well as revoked users", async () => {
  vi.mocked(validateAdminManagerSession).mockResolvedValue(null)
  await expect(
    authenticateStudioMcp(await request(), "shorts:read"),
  ).rejects.toThrow("membership")
  vi.mocked(validateAdminManagerSession).mockResolvedValue({
    user: { id: "reviewer", email: "reviewer@example.test" },
    managerRole: "REVIEWER",
    reviewerLanguageGrants: [],
  })
  await expect(
    authenticateStudioMcp(await request(), "shorts:read"),
  ).rejects.toThrow("membership")
})
