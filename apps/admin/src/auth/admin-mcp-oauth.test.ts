import { beforeEach, describe, expect, it, vi } from "vitest"

const jwtVerify = vi.fn()
const findUnique = vi.fn()

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "jwks"),
  jwtVerify: (...args: unknown[]) => jwtVerify(...args),
}))

vi.mock("@/db/client", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
  },
}))

import {
  resolveAdminMcpPrincipal,
  verifyAdminMcpBearerToken,
  type AdminMcpOAuthConfig,
} from "./admin-mcp-oauth"

const config: AdminMcpOAuthConfig = {
  issuerUrl: "https://auth.jesusfilm.org",
  audience: "https://admin.jesusfilm.org/mcp",
  allowedClientIds: ["jfp_admin_mcp_production"],
  tokenEnvironment: "production",
}

describe("admin MCP OAuth", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    jwtVerify.mockReset()
    findUnique.mockReset()
  })

  it("verifies issuer, audience, client, environment, and required scopes", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: {
        sub: "user_123",
        email: "editor@example.com",
        name: "Editor User",
        client_id: "jfp_admin_mcp_production",
        scope: "openid experience:read experience:locale:update",
        "https://jesusfilm.org/claims/environment": "production",
      },
    })

    await expect(
      verifyAdminMcpBearerToken({
        authHeader: "Bearer access-token",
        requiredScopes: ["experience:read", "experience:locale:update"],
        config,
      }),
    ).resolves.toMatchObject({
      subject: "user_123",
      email: "editor@example.com",
      name: "Editor User",
      clientId: "jfp_admin_mcp_production",
      scopes: ["openid", "experience:read", "experience:locale:update"],
    })

    expect(jwtVerify).toHaveBeenCalledWith("access-token", "jwks", {
      issuer: "https://auth.jesusfilm.org",
      audience: "https://admin.jesusfilm.org/mcp",
    })
  })

  it("rejects missing bearer tokens with required scopes", async () => {
    await expect(
      verifyAdminMcpBearerToken({
        authHeader: null,
        requiredScopes: ["experience:read"],
        config,
      }),
    ).rejects.toMatchObject({
      code: "missing_token",
      requiredScopes: ["experience:read"],
    })
  })

  it("rejects invalid tokens", async () => {
    jwtVerify.mockRejectedValueOnce(new Error("bad signature"))

    await expect(
      verifyAdminMcpBearerToken({
        authHeader: "Bearer bad-token",
        requiredScopes: ["experience:read"],
        config,
      }),
    ).rejects.toMatchObject({
      code: "invalid_token",
      requiredScopes: ["experience:read"],
    })
  })

  it("rejects tokens missing required scopes", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: {
        sub: "user_123",
        client_id: "jfp_admin_mcp_production",
        scope: "openid experience:read",
        "https://jesusfilm.org/claims/environment": "production",
      },
    })

    await expect(
      verifyAdminMcpBearerToken({
        authHeader: "Bearer access-token",
        requiredScopes: ["experience:read", "experience:publish"],
        config,
      }),
    ).rejects.toMatchObject({
      code: "insufficient_scope",
      requiredScopes: ["experience:read", "experience:publish"],
    })
  })

  it("rejects tokens from unauthorized Admin MCP clients", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: {
        sub: "user_123",
        client_id: "jfp_admin_production",
        scope: "openid experience:read",
        "https://jesusfilm.org/claims/environment": "production",
      },
    })

    await expect(
      verifyAdminMcpBearerToken({
        authHeader: "Bearer access-token",
        requiredScopes: ["experience:read"],
        config,
      }),
    ).rejects.toMatchObject({ code: "invalid_client" })
  })

  it("accepts dynamically registered MCP clients when no allow-list is configured", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: {
        sub: "user_123",
        client_id: "dynamic_mcp_client",
        scope: "openid experience:read",
        "https://jesusfilm.org/claims/environment": "production",
      },
    })

    await expect(
      verifyAdminMcpBearerToken({
        authHeader: "Bearer access-token",
        requiredScopes: ["experience:read"],
        config: { ...config, allowedClientIds: undefined },
      }),
    ).resolves.toMatchObject({
      clientId: "dynamic_mcp_client",
      scopes: ["openid", "experience:read"],
    })
  })

  it("rejects tokens from the wrong environment", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: {
        sub: "user_123",
        client_id: "jfp_admin_mcp_production",
        scope: "openid experience:read",
        "https://jesusfilm.org/claims/environment": "staging",
      },
    })

    await expect(
      verifyAdminMcpBearerToken({
        authHeader: "Bearer access-token",
        requiredScopes: ["experience:read"],
        config,
      }),
    ).rejects.toMatchObject({ code: "invalid_token" })
  })

  it("resolves editor users to Admin principals by email", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: {
        sub: "auth_subject",
        email: "editor@example.com",
        client_id: "jfp_admin_mcp_production",
        scope: "openid experience:read",
        "https://jesusfilm.org/claims/environment": "production",
      },
    })
    findUnique.mockResolvedValueOnce({ id: "admin_user_1", role: "EDITOR" })

    await expect(
      resolveAdminMcpPrincipal({
        authHeader: "Bearer access-token",
        requiredScopes: ["experience:read"],
        config,
      }),
    ).resolves.toMatchObject({
      principal: {
        id: "admin_user_1",
        role: "EDITOR",
        rateLimitBucketKey: "admin-mcp:admin_user_1",
      },
    })

    expect(findUnique).toHaveBeenCalledWith({
      where: { email: "editor@example.com" },
      select: { id: true, role: true },
    })
  })

  it("falls back to subject lookup when email is absent", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: {
        sub: "auth_subject",
        client_id: "jfp_admin_mcp_production",
        scope: "openid experience:read",
        "https://jesusfilm.org/claims/environment": "production",
      },
    })
    findUnique.mockResolvedValueOnce({ id: "auth_subject", role: "ADMIN" })

    await expect(
      resolveAdminMcpPrincipal({
        authHeader: "Bearer access-token",
        requiredScopes: ["experience:read"],
        config,
      }),
    ).resolves.toMatchObject({
      principal: {
        id: "auth_subject",
        role: "ADMIN",
      },
    })

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "auth_subject" },
      select: { id: true, role: true },
    })
  })

  it("rejects users who are not active in Admin", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: {
        sub: "auth_subject",
        client_id: "jfp_admin_mcp_production",
        scope: "openid experience:read",
        "https://jesusfilm.org/claims/environment": "production",
      },
    })
    findUnique.mockResolvedValueOnce(null)

    await expect(
      resolveAdminMcpPrincipal({
        authHeader: "Bearer access-token",
        requiredScopes: ["experience:read"],
        config,
      }),
    ).rejects.toMatchObject({ code: "inactive_user" })
  })

  it("rejects viewer users before service-layer ABAC", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: {
        sub: "viewer_subject",
        client_id: "jfp_admin_mcp_production",
        scope: "openid experience:read",
        "https://jesusfilm.org/claims/environment": "production",
      },
    })
    findUnique.mockResolvedValueOnce({ id: "viewer_subject", role: "VIEWER" })

    await expect(
      resolveAdminMcpPrincipal({
        authHeader: "Bearer access-token",
        requiredScopes: ["experience:read"],
        config,
      }),
    ).rejects.toMatchObject({ code: "forbidden_role" })
  })
})
