import { describe, expect, it } from "vitest"

import {
  getFirstPartyAppSeeds,
  isExactRedirectUriAllowed,
  requiresProductionApproval,
  validateAppEnvironmentPolicy,
} from "./app-registry.service"

describe("app registry policy", () => {
  it("allows exact redirect URI matches only", () => {
    expect(
      isExactRedirectUriAllowed(
        "https://admin.jesusfilm.org/api/auth/callback",
        ["https://admin.jesusfilm.org/api/auth/callback"],
      ),
    ).toBe(true)

    expect(
      isExactRedirectUriAllowed(
        "https://admin.jesusfilm.org/api/auth/callback/",
        ["https://admin.jesusfilm.org/api/auth/callback"],
      ),
    ).toBe(false)
  })

  it("requires production environments to be approved before use", () => {
    expect(
      requiresProductionApproval({
        kind: "production",
        status: "pending",
        autoApprove: true,
        redirectUris: ["https://admin.jesusfilm.org/api/auth/callback"],
        allowedOrigins: ["https://admin.jesusfilm.org"],
        defaultScopes: ["openid"],
      }),
    ).toBe(true)
  })

  it("allows the Codex MCP client to rely on dynamic loopback redirects", () => {
    expect(() =>
      validateAppEnvironmentPolicy({
        clientId: "jfp_admin_mcp_codex",
        kind: "production",
        status: "approved",
        autoApprove: true,
        redirectUris: [],
        allowedOrigins: [],
        defaultScopes: ["openid"],
      }),
    ).not.toThrow()
  })

  it("allows TV device clients to register with no browser origin", () => {
    expect(() =>
      validateAppEnvironmentPolicy({
        clientId: "jfp_tv_production",
        kind: "production",
        status: "approved",
        autoApprove: true,
        redirectUris: ["https://auth.jesusfilm.org/device/callback"],
        allowedOrigins: [],
        defaultScopes: ["openid"],
      }),
    ).not.toThrow()
  })

  it("still requires an allowed origin for clients outside the exemption set", () => {
    // Anti-vacuous companion: the TV case above passes because of set
    // membership, not because the allowed-origin check stopped running.
    expect(() =>
      validateAppEnvironmentPolicy({
        clientId: "jfp_web_production",
        kind: "production",
        status: "approved",
        autoApprove: true,
        redirectUris: ["https://www.jesusfilm.org/watch/api/auth/callback"],
        allowedOrigins: [],
        defaultScopes: ["openid"],
      }),
    ).toThrow("App environment must define at least one allowed origin.")
  })

  it("does not let the TV origin exemption waive its sentinel redirect URI", () => {
    // The device grant binds a redirect URI into the authorization code, so a
    // TV environment seeded without one is a misconfiguration, not a variant.
    expect(() =>
      validateAppEnvironmentPolicy({
        clientId: "jfp_tv_production",
        kind: "production",
        status: "approved",
        autoApprove: true,
        redirectUris: [],
        allowedOrigins: [],
        defaultScopes: ["openid"],
      }),
    ).toThrow("App environment must define at least one redirect URI.")
  })

  it("still requires static redirects for regular clients", () => {
    expect(() =>
      validateAppEnvironmentPolicy({
        clientId: "jfp_admin_production",
        kind: "production",
        status: "approved",
        autoApprove: true,
        redirectUris: [],
        allowedOrigins: ["https://admin.jesusfilm.org"],
        defaultScopes: ["openid"],
      }),
    ).toThrow("App environment must define at least one redirect URI.")
  })

  it("validates first-party seeds", () => {
    const seeds = getFirstPartyAppSeeds()

    expect(seeds.map((seed) => seed.key)).toEqual([
      "admin",
      "manager",
      "web",
      "mastra-studio",
      "chat",
      "admin-mcp",
      "mobile",
      "tv",
    ])

    for (const seed of seeds) {
      for (const environment of seed.environments) {
        expect(() =>
          validateAppEnvironmentPolicy({
            clientId: environment.clientId,
            kind: environment.kind,
            status: "approved",
            autoApprove: environment.autoApprove,
            redirectUris: environment.redirectUris,
            allowedOrigins: environment.allowedOrigins,
            defaultScopes: environment.defaultScopes,
          }),
        ).not.toThrow()
      }
    }
  })
})
