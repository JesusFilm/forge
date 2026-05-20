import { describe, expect, it } from "vitest"

import {
  ADMIN_APP_SEED,
  FIRST_PARTY_APP_SEEDS,
  MANAGER_APP_KEY,
  MANAGER_APP_SEED,
} from "./apps"

describe("first-party app seeds", () => {
  it("keeps Admin and Manager registered as distinct first-party OAuth apps", () => {
    expect(FIRST_PARTY_APP_SEEDS.map((app) => app.key)).toEqual([
      ADMIN_APP_SEED.key,
      MANAGER_APP_KEY,
    ])
    expect(MANAGER_APP_SEED).toEqual(
      expect.objectContaining({
        key: "manager",
        displayName: "Jesus Film Manager",
        trustTier: "first_party",
        ownerType: "jesus_film",
      }),
    )
  })

  it("registers Manager OAuth clients for local, preview, staging, and production", () => {
    expect(MANAGER_APP_SEED.environments.map((env) => env.key)).toEqual([
      "local",
      "preview",
      "staging",
      "production",
    ])
    expect(MANAGER_APP_SEED.environments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "local",
          clientId: "jfp_manager_local",
          redirectUris: ["http://localhost:3002/api/auth/callback"],
          postLogoutRedirectUris: ["http://localhost:3002/login"],
          allowedOrigins: ["http://localhost:3002"],
          defaultScopes: expect.arrayContaining(["manager:access"]),
          autoApprove: true,
        }),
        expect.objectContaining({
          key: "production",
          clientId: "jfp_manager_production",
          redirectUris: ["https://manager.jesusfilm.org/api/auth/callback"],
          postLogoutRedirectUris: ["https://manager.jesusfilm.org/login"],
          allowedOrigins: ["https://manager.jesusfilm.org"],
          defaultScopes: expect.arrayContaining(["manager:access"]),
          autoApprove: true,
        }),
      ]),
    )
  })
})
