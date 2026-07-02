import { describe, expect, it } from "vitest"

import {
  ADMIN_APP_SEED,
  CHAT_APP_KEY,
  CHAT_APP_SEED,
  FIRST_PARTY_APP_SEEDS,
  MASTRA_STUDIO_APP_KEY,
  MASTRA_STUDIO_APP_SEED,
  MANAGER_APP_KEY,
  MANAGER_APP_SEED,
  WEB_APP_KEY,
  WEB_APP_SEED,
} from "./apps"

describe("first-party app seeds", () => {
  it("keeps Admin and Manager registered as distinct first-party OAuth apps", () => {
    expect(FIRST_PARTY_APP_SEEDS.map((app) => app.key)).toEqual([
      ADMIN_APP_SEED.key,
      MANAGER_APP_KEY,
      WEB_APP_KEY,
      MASTRA_STUDIO_APP_KEY,
      CHAT_APP_KEY,
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

  it("registers Web OAuth clients with watch-event scope and audience metadata", () => {
    expect(WEB_APP_SEED.environments.map((env) => env.key)).toEqual([
      "local",
      "preview",
      "staging",
      "production",
    ])
    expect(WEB_APP_SEED.environments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "local",
          clientId: "jfp_web_local",
          redirectUris: ["http://localhost:3000/watch/api/auth/callback"],
          postLogoutRedirectUris: ["http://localhost:3000/watch"],
          allowedOrigins: ["http://localhost:3000"],
          defaultScopes: expect.arrayContaining(["web:watch-events:write"]),
          autoApprove: true,
        }),
        expect.objectContaining({
          key: "production",
          clientId: "jfp_web_production",
          redirectUris: [
            "https://www.jesusfilm.org/watch/api/auth/callback",
            "https://watch.jesusfilm.org/watch/api/auth/callback",
          ],
          postLogoutRedirectUris: [
            "https://www.jesusfilm.org/watch",
            "https://watch.jesusfilm.org/watch",
          ],
          allowedOrigins: [
            "https://www.jesusfilm.org",
            "https://watch.jesusfilm.org",
          ],
          defaultScopes: expect.arrayContaining(["web:watch-events:write"]),
          autoApprove: true,
        }),
      ]),
    )
  })

  it("registers the Chat OAuth client for local development only", () => {
    expect(CHAT_APP_SEED.environments.map((env) => env.key)).toEqual(["local"])
    expect(CHAT_APP_SEED.environments).toEqual([
      expect.objectContaining({
        key: "local",
        clientId: "jfp_chat_local",
        redirectUris: ["http://localhost:3200/api/auth/callback"],
        postLogoutRedirectUris: ["http://localhost:3200"],
        allowedOrigins: ["http://localhost:3200"],
        // Identity-only — no *:access, no membership:read (feat-207 R7).
        defaultScopes: ["openid", "profile:read", "email:read"],
        autoApprove: true,
      }),
    ])
  })

  it("registers Mastra Studio OAuth clients for the gateway", () => {
    expect(MASTRA_STUDIO_APP_SEED.environments.map((env) => env.key)).toEqual([
      "local",
      "preview",
      "staging",
      "production",
    ])
    expect(MASTRA_STUDIO_APP_SEED.environments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "local",
          clientId: "jfp_mastra_studio_local",
          redirectUris: ["http://localhost:3005/api/auth/callback"],
          postLogoutRedirectUris: ["http://localhost:3005/api/auth/login"],
          allowedOrigins: ["http://localhost:3005"],
          defaultScopes: expect.arrayContaining(["mastra-studio:access"]),
          autoApprove: true,
        }),
        expect.objectContaining({
          key: "production",
          clientId: "jfp_mastra_studio_production",
          redirectUris: ["https://mastra.jesusfilm.org/api/auth/callback"],
          postLogoutRedirectUris: [
            "https://mastra.jesusfilm.org/api/auth/login",
          ],
          allowedOrigins: ["https://mastra.jesusfilm.org"],
          defaultScopes: expect.arrayContaining(["mastra-studio:access"]),
          autoApprove: true,
        }),
        expect.objectContaining({
          key: "preview",
          clientId: "jfp_mastra_studio_preview",
          redirectUris: [
            "https://forgemastra-gateway.up.railway.app/api/auth/callback",
          ],
          postLogoutRedirectUris: [
            "https://forgemastra-gateway.up.railway.app/api/auth/login",
          ],
          allowedOrigins: ["https://forgemastra-gateway.up.railway.app"],
          defaultScopes: expect.arrayContaining(["mastra-studio:access"]),
          autoApprove: true,
        }),
      ]),
    )
  })

  it("registers Web OAuth clients for public watch sign-in", () => {
    expect(WEB_APP_SEED).toEqual(
      expect.objectContaining({
        key: "web",
        displayName: "Jesus Film Web",
        trustTier: "first_party",
        ownerType: "jesus_film",
      }),
    )
    expect(WEB_APP_SEED.environments.map((env) => env.key)).toEqual([
      "local",
      "preview",
      "staging",
      "production",
    ])
    expect(WEB_APP_SEED.environments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "local",
          clientId: "jfp_web_local",
          redirectUris: ["http://localhost:3000/watch/api/auth/callback"],
          postLogoutRedirectUris: ["http://localhost:3000/watch"],
          allowedOrigins: ["http://localhost:3000"],
          defaultScopes: expect.arrayContaining([
            "openid",
            "profile:read",
            "email:read",
            "web:watch-events:write",
          ]),
          autoApprove: true,
        }),
        expect.objectContaining({
          key: "production",
          clientId: "jfp_web_production",
          redirectUris: [
            "https://www.jesusfilm.org/watch/api/auth/callback",
            "https://watch.jesusfilm.org/watch/api/auth/callback",
          ],
          postLogoutRedirectUris: [
            "https://www.jesusfilm.org/watch",
            "https://watch.jesusfilm.org/watch",
          ],
          allowedOrigins: [
            "https://www.jesusfilm.org",
            "https://watch.jesusfilm.org",
          ],
          defaultScopes: expect.arrayContaining(["web:watch-events:write"]),
          autoApprove: true,
        }),
      ]),
    )
  })
})
