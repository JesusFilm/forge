import { describe, expect, it } from "vitest"

import {
  createOAuthResourceCatalog,
  getPublicDcrAllowedScopes,
  getPublicDcrResources,
  resolveOAuthResource,
} from "./oauth-resources"
import { ADMIN_MCP_DEFAULT_SCOPES, CHANGELOG_DEFAULT_SCOPES } from "./apps"

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
        new Set([...ADMIN_MCP_DEFAULT_SCOPES, ...CHANGELOG_DEFAULT_SCOPES]),
      ),
    )
    expect(getPublicDcrAllowedScopes(catalogue)).not.toContain(
      "admin:manager-session:validate",
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
