import { afterEach, describe, expect, it, vi } from "vitest"
import { shortsLocalPublicOrigin } from "./shorts-local-origin"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("local Shorts tunnel origin", () => {
  it("is opt-in and normalizes an HTTPS origin", () => {
    expect(shortsLocalPublicOrigin("", "production")).toBeUndefined()
    expect(
      shortsLocalPublicOrigin("https://shorts.example.test/", "development"),
    ).toBe("https://shorts.example.test")
  })

  it.each([
    "http://shorts.example.test",
    "https://user:password@shorts.example.test",
    "https://shorts.example.test/mcp",
    "https://shorts.example.test/?extra=true",
    "https://shorts.example.test/#fragment",
    "not a URL",
  ])("rejects a non-origin configuration (%s)", (value) => {
    expect(() => shortsLocalPublicOrigin(value, "development")).toThrow()
  })

  it("refuses the override in production", () => {
    expect(() =>
      shortsLocalPublicOrigin("https://shorts.example.test", "production"),
    ).toThrow("local-only")
  })

  it("seeds and classifies only the explicit local Shorts origin", async () => {
    vi.stubEnv("AUTH_SHORTS_LOCAL_PUBLIC_ORIGIN", "https://shorts.example.test")
    vi.resetModules()
    const { STUDIO_MCP_APP_SEED, MANAGER_APP_SEED } = await import("./apps")
    const { createOAuthResourceCatalog, resolveOAuthResource } =
      await import("./oauth-resources")
    const local = STUDIO_MCP_APP_SEED.environments.find(
      (e) => e.kind === "local",
    )
    expect(local).toMatchObject({
      clientId: "jfp_shorts_mcp_local",
      allowedOrigins: ["https://shorts.example.test"],
      redirectUris: ["https://shorts.example.test/mcp/oauth/callback"],
      mcpResourceAudience: "https://shorts.example.test/mcp",
    })
    const catalog = createOAuthResourceCatalog({
      authIssuer: "https://auth.example.test",
      customAudiences: [],
    })
    expect(
      resolveOAuthResource(catalog, "https://shorts.example.test/mcp"),
    ).toMatchObject({
      resourceClass: "shorts-mcp",
      trustedApp: "shorts-mcp",
      trustedEnvironment: "local",
      dcrExposure: "public",
    })
    expect(
      resolveOAuthResource(catalog, "http://localhost:3002/mcp"),
    ).toBeUndefined()
    expect(
      resolveOAuthResource(catalog, "https://manager.jesusfilm.org/mcp"),
    ).toMatchObject({
      trustedEnvironment: "production",
      resourceClass: "shorts-mcp",
    })
    expect(
      MANAGER_APP_SEED.environments.find((e) => e.kind === "local")
        ?.allowedOrigins,
    ).toEqual(["http://localhost:3002"])
  })

  it("does not relabel a hosted Shorts resource as local", async () => {
    vi.stubEnv(
      "AUTH_SHORTS_LOCAL_PUBLIC_ORIGIN",
      "https://manager.jesusfilm.org",
    )
    vi.resetModules()
    await expect(import("./apps")).rejects.toThrow(
      "must not replace a hosted environment",
    )
  })
})
