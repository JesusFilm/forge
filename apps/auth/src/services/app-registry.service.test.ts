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

  it("validates first-party seeds", () => {
    const seeds = getFirstPartyAppSeeds()

    expect(seeds.map((seed) => seed.key)).toEqual([
      "admin",
      "manager",
      "web",
      "mastra-studio",
    ])

    for (const seed of seeds) {
      for (const environment of seed.environments) {
        expect(() =>
          validateAppEnvironmentPolicy({
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
