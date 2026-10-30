import { describe, expect, it } from "vitest"

import {
  createOAuthResourceCatalog,
  getPublicDcrAllowedScopes,
  getPublicDcrResources,
  isWatchUserDataAuthorization,
  resolveOAuthResource,
} from "./oauth-resources"
import {
  ADMIN_MCP_DEFAULT_SCOPES,
  CHANGELOG_DEFAULT_SCOPES,
  WEB_DEFAULT_SCOPES,
} from "./apps"

const AUTH_ISSUER = "https://auth.jesusfilm.org"

describe("OAuth resource catalogue", () => {
  it("classifies every known MCP and Manager resource without duplicates", () => {
    const catalogue = createOAuthResourceCatalog({
      authIssuer: AUTH_ISSUER,
      customAudiences: [],
    })

    expect(
      catalogue
        .filter(({ resourceClass }) => resourceClass === "admin-mcp")
        .map(({ trustedEnvironment }) => trustedEnvironment),
    ).toEqual(["local", "preview", "staging", "production"])
    expect(
      catalogue
        .filter(({ resourceClass }) => resourceClass === "changelog-mcp")
        .map(({ trustedEnvironment }) => trustedEnvironment),
    ).toEqual(["local", "production"])
    expect(
      catalogue.filter(
        ({ resourceClass }) => resourceClass === "manager-session",
      ),
    ).toHaveLength(4)
    expect(
      new Set(catalogue.map(({ identifier }) => identifier)),
    ).toHaveProperty("size", catalogue.length)
  })

  it("binds public MCP resources to product-specific scopes and trusted claims", () => {
    const catalogue = createOAuthResourceCatalog({
      authIssuer: AUTH_ISSUER,
      customAudiences: [],
    })

    expect(
      resolveOAuthResource(catalogue, "https://admin.jesusfilm.org/mcp"),
    ).toEqual(
      expect.objectContaining({
        resourceClass: "admin-mcp",
        trustedProduct: "admin",
        trustedApp: "admin-mcp",
        trustedEnvironment: "production",
        allowedScopes: ADMIN_MCP_DEFAULT_SCOPES,
        dcrExposure: "public",
      }),
    )
    expect(
      resolveOAuthResource(catalogue, "https://changelog.jesusfilm.org/mcp"),
    ).toEqual(
      expect.objectContaining({
        resourceClass: "changelog-mcp",
        trustedProduct: "changelog",
        trustedApp: "changelog",
        trustedEnvironment: "production",
        allowedScopes: CHANGELOG_DEFAULT_SCOPES,
        dcrExposure: "public",
      }),
    )
    expect(
      resolveOAuthResource(
        catalogue,
        "https://admin.jesusfilm.org/api/manager/session",
      )?.allowedScopes,
    ).toEqual(["admin:manager-session:validate"])
  })

  it("keeps compatibility audiences protected and outside public DCR", () => {
    const customAudience = "https://custom.example.test"
    const catalogue = createOAuthResourceCatalog({
      authIssuer: AUTH_ISSUER,
      customAudiences: [customAudience, AUTH_ISSUER, customAudience],
    })
    const publicResources = getPublicDcrResources(catalogue)

    expect(catalogue.map(({ identifier }) => identifier)).toEqual(
      expect.arrayContaining([AUTH_ISSUER, customAudience]),
    )
    expect(publicResources).toEqual([
      "http://localhost:3003/mcp",
      "https://admin-preview.jesusfilm.org/mcp",
      "https://admin-stage.jesusfilm.org/mcp",
      "https://admin.jesusfilm.org/mcp",
      "http://localhost:3000/mcp",
      "https://changelog.jesusfilm.org/mcp",
      "http://localhost:3002/mcp",
      "https://manager-preview.jesusfilm.org/mcp",
      "https://manager-stage.jesusfilm.org/mcp",
      "https://manager.jesusfilm.org/mcp",
    ])
    expect(publicResources).not.toEqual(
      expect.arrayContaining([AUTH_ISSUER, customAudience]),
    )
    expect(resolveOAuthResource(catalogue, customAudience)?.dcrExposure).toBe(
      "protected",
    )
  })

  it("derives the public DCR scope allowlist from the public resource union", () => {
    const catalogue = createOAuthResourceCatalog({
      authIssuer: AUTH_ISSUER,
      customAudiences: [],
    })

    expect(getPublicDcrAllowedScopes(catalogue)).toEqual(
      Array.from(
        new Set([
          ...ADMIN_MCP_DEFAULT_SCOPES,
          ...CHANGELOG_DEFAULT_SCOPES,
          "shorts:read",
          "shorts:edit",
          "shorts:render",
          "shorts:chat",
          "shorts:narration",
          "shorts:instructions:read",
        ]),
      ),
    )
    expect(getPublicDcrAllowedScopes(catalogue)).not.toContain(
      "admin:manager-session:validate",
    )
  })

  it("derives one protected Watch user-data resource per Admin GraphQL environment", () => {
    const catalogue = createOAuthResourceCatalog({
      authIssuer: AUTH_ISSUER,
      customAudiences: [],
    })
    const watch = catalogue.filter(
      ({ resourceClass }) => resourceClass === "watch-user-data",
    )

    expect(watch.map(({ identifier }) => identifier)).toEqual([
      "http://localhost:3003/api/graphql",
      "https://admin-preview.jesusfilm.org/api/graphql",
      "https://admin-stage.jesusfilm.org/api/graphql",
      "https://admin.jesusfilm.org/api/graphql",
    ])
    expect(watch.map(({ trustedEnvironment }) => trustedEnvironment)).toEqual([
      "local",
      "preview",
      "staging",
      "production",
    ])
    for (const policy of watch) {
      expect(policy).toMatchObject({
        trustedProduct: "admin",
        trustedApp: "web",
        allowedScopes: WEB_DEFAULT_SCOPES,
        dcrExposure: "protected",
      })
    }
    expect(getPublicDcrResources(catalogue)).not.toEqual(
      expect.arrayContaining(watch.map(({ identifier }) => identifier)),
    )
  })

  it("keeps the Watch user-data class when the same URL is also a custom audience", () => {
    const catalogue = createOAuthResourceCatalog({
      authIssuer: AUTH_ISSUER,
      customAudiences: ["http://localhost:3003/api/graphql"],
    })

    expect(
      resolveOAuthResource(catalogue, "http://localhost:3003/api/graphql")
        ?.resourceClass,
    ).toBe("watch-user-data")
  })

  it("admits only the same-environment Web client with Web scopes", () => {
    const catalogue = createOAuthResourceCatalog({
      authIssuer: AUTH_ISSUER,
      customAudiences: ["http://localhost:4318/api/graphql"],
    })
    const local = resolveOAuthResource(
      catalogue,
      "http://localhost:3003/api/graphql",
    )!
    const production = resolveOAuthResource(
      catalogue,
      "https://admin.jesusfilm.org/api/graphql",
    )!
    const custom = resolveOAuthResource(
      catalogue,
      "http://localhost:4318/api/graphql",
    )!

    expect(
      isWatchUserDataAuthorization(local, "jfp_web_local", [
        ...WEB_DEFAULT_SCOPES,
      ]),
    ).toBe(true)
    // Omitted scope falls back to the client's seeded Web defaults.
    expect(isWatchUserDataAuthorization(local, "jfp_web_local", null)).toBe(
      true,
    )
    expect(
      isWatchUserDataAuthorization(production, "jfp_web_production", [
        "openid",
        "web:watch-events:write",
      ]),
    ).toBe(true)

    expect(
      isWatchUserDataAuthorization(production, "jfp_web_local", null),
    ).toBe(false)
    expect(
      isWatchUserDataAuthorization(local, "jfp_web_production", null),
    ).toBe(false)
    expect(isWatchUserDataAuthorization(local, "jfp_tv_local", null)).toBe(
      false,
    )
    expect(isWatchUserDataAuthorization(local, "jfp_admin_local", null)).toBe(
      false,
    )
    expect(isWatchUserDataAuthorization(local, null, null)).toBe(false)
    expect(
      isWatchUserDataAuthorization(local, "jfp_web_local", [
        "openid",
        "admin:access",
      ]),
    ).toBe(false)
    expect(
      isWatchUserDataAuthorization(local, "jfp_web_local", [
        "openid",
        "membership:read",
      ]),
    ).toBe(false)
    expect(isWatchUserDataAuthorization(custom, "jfp_web_local", null)).toBe(
      false,
    )
  })

  it("returns no policy for an unknown resource", () => {
    const catalogue = createOAuthResourceCatalog({
      authIssuer: AUTH_ISSUER,
      customAudiences: [],
    })

    expect(
      resolveOAuthResource(catalogue, "https://unknown.example.test"),
    ).toBeUndefined()
  })
})

it("does not advertise retired Studio scopes", () => {
  const scopes = getPublicDcrAllowedScopes(
    createOAuthResourceCatalog({
      authIssuer: AUTH_ISSUER,
      customAudiences: [],
    }),
  )
  expect(scopes).toContain("shorts:read")
  expect(scopes.some((scope) => scope.startsWith("studio:"))).toBe(false)
})

it("keeps the production Shorts resource ceiling independent of the narrow ChatGPT client", async () => {
  const { STUDIO_CHATGPT_SCOPES, STUDIO_MCP_RESOURCE_SCOPES } =
    await import("./apps")
  const catalog = createOAuthResourceCatalog({
    authIssuer: AUTH_ISSUER,
    customAudiences: [],
  })
  const resource = resolveOAuthResource(
    catalog,
    "https://manager.jesusfilm.org/mcp",
  )
  expect(resource).toMatchObject({
    trustedApp: "shorts-mcp",
    trustedEnvironment: "production",
    allowedScopes: STUDIO_MCP_RESOURCE_SCOPES,
  })
  expect(resource?.allowedScopes).toContain("shorts:chat")
  expect(STUDIO_CHATGPT_SCOPES).not.toContain("shorts:chat")
  expect(catalog.filter((r) => r.resourceClass === "shorts-mcp")).toHaveLength(
    4,
  )
})
