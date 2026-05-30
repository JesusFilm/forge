import { describe, expect, it } from "vitest"

import { isDynamicRailwayPreviewRedirectUriAllowed } from "./dynamic-preview-redirect.service"

describe("dynamic preview redirect policy", () => {
  it("allows Railway PR callback URLs for preview/staging admin clients", () => {
    expect(
      isDynamicRailwayPreviewRedirectUriAllowed({
        clientId: "jfp_admin_staging",
        redirectUri:
          "https://forge-admin-pr-123.up.railway.app/api/auth/callback",
      }),
    ).toBe(true)
  })

  it("does not allow production clients or non-callback paths", () => {
    expect(
      isDynamicRailwayPreviewRedirectUriAllowed({
        clientId: "jfp_admin_production",
        redirectUri:
          "https://forge-admin-pr-123.up.railway.app/api/auth/callback",
      }),
    ).toBe(false)

    expect(
      isDynamicRailwayPreviewRedirectUriAllowed({
        clientId: "jfp_admin_staging",
        redirectUri: "https://forge-admin-pr-123.up.railway.app/dashboard",
      }),
    ).toBe(false)
  })

  it("does not allow unrelated Railway apps to use the admin OAuth client", () => {
    expect(
      isDynamicRailwayPreviewRedirectUriAllowed({
        clientId: "jfp_admin_staging",
        redirectUri: "https://example.up.railway.app/api/auth/callback",
      }),
    ).toBe(false)
  })

  it("allows Railway callback URLs for Mastra Studio preview clients", () => {
    expect(
      isDynamicRailwayPreviewRedirectUriAllowed({
        clientId: "jfp_mastra_studio_preview",
        redirectUri:
          "https://forge-mastra-studio-pr-123.up.railway.app/api/auth/callback",
      }),
    ).toBe(true)
    expect(
      isDynamicRailwayPreviewRedirectUriAllowed({
        clientId: "jfp_mastra_studio_preview",
        redirectUri:
          "https://forgemastra-gateway-forge-pr-992.up.railway.app/api/auth/callback",
      }),
    ).toBe(true)
  })

  it("does not allow Mastra Studio preview clients to use admin preview hosts", () => {
    expect(
      isDynamicRailwayPreviewRedirectUriAllowed({
        clientId: "jfp_mastra_studio_preview",
        redirectUri:
          "https://forge-admin-pr-123.up.railway.app/api/auth/callback",
      }),
    ).toBe(false)
  })
})
