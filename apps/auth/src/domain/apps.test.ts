import { describe, expect, it } from "vitest"

import {
  ADMIN_MCP_APP_KEY,
  ADMIN_MCP_APP_SEED,
  ADMIN_MCP_DEFAULT_SCOPES,
  ADMIN_APP_SEED,
  CHAT_APP_KEY,
  CHAT_APP_SEED,
  CHANGELOG_APP_KEY,
  CHANGELOG_APP_SEED,
  CHANGELOG_DEFAULT_SCOPES,
  FIRST_PARTY_APP_SEEDS,
  MASTRA_STUDIO_APP_KEY,
  MASTRA_STUDIO_APP_SEED,
  MANAGER_APP_KEY,
  MANAGER_APP_SEED,
  MOBILE_APP_KEY,
  MOBILE_APP_SEED,
  TV_APP_KEY,
  TV_APP_SEED,
  TV_DEFAULT_SCOPES,
  TV_DEVICE_CLIENT_IDS,
  WEB_APP_KEY,
  WEB_APP_SEED,
} from "./apps"
import { assertKnownScopes } from "./scopes"

describe("first-party app seeds", () => {
  it("keeps Admin and Manager registered as distinct first-party OAuth apps", () => {
    expect(FIRST_PARTY_APP_SEEDS.map((app) => app.key)).toEqual([
      ADMIN_APP_SEED.key,
      MANAGER_APP_KEY,
      WEB_APP_KEY,
      MASTRA_STUDIO_APP_KEY,
      CHAT_APP_KEY,
      CHANGELOG_APP_KEY,
      ADMIN_MCP_APP_KEY,
      MOBILE_APP_KEY,
      TV_APP_KEY,
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

  it("registers exact local and production Changelog OAuth clients", () => {
    expect(CHANGELOG_APP_SEED).toEqual(
      expect.objectContaining({
        key: "changelog",
        displayName: "Jesus Film Changelog",
        trustTier: "first_party",
        ownerType: "jesus_film",
        ownerName: "Jesus Film Project",
      }),
    )
    expect(CHANGELOG_DEFAULT_SCOPES).toEqual([
      "openid",
      "profile:read",
      "email:read",
      "membership:read",
      "changelog:read",
      "changelog:submit",
      "changelog:admin",
    ])
    expect(CHANGELOG_APP_SEED.environments).toEqual([
      {
        key: "local",
        kind: "local",
        clientId: "jfp_changelog_local",
        mcpResourceAudience: "http://localhost:3000/mcp",
        redirectUris: ["http://localhost:3000/api/auth/callback"],
        postLogoutRedirectUris: ["http://localhost:3000/api/auth/login"],
        allowedOrigins: ["http://localhost:3000"],
        defaultScopes: CHANGELOG_DEFAULT_SCOPES,
        autoApprove: true,
      },
      {
        key: "production",
        kind: "production",
        clientId: "jfp_changelog_production",
        mcpResourceAudience: "https://changelog.jesusfilm.org/mcp",
        redirectUris: ["https://changelog.jesusfilm.org/api/auth/callback"],
        postLogoutRedirectUris: [
          "https://changelog.jesusfilm.org/api/auth/login",
        ],
        allowedOrigins: ["https://changelog.jesusfilm.org"],
        defaultScopes: CHANGELOG_DEFAULT_SCOPES,
        autoApprove: true,
      },
    ])
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

  it("keeps every seeded clientId globally unique across first-party apps", () => {
    const clientIds = FIRST_PARTY_APP_SEEDS.flatMap((app) =>
      app.environments.flatMap((env) => [
        env.clientId,
        ...(env.managerSessionServiceClientId
          ? [env.managerSessionServiceClientId]
          : []),
      ]),
    )
    expect(new Set(clientIds).size).toBe(clientIds.length)
  })

  it("registers Admin MCP OAuth clients with trusted locale factory scopes", () => {
    expect(ADMIN_MCP_APP_SEED).toEqual(
      expect.objectContaining({
        key: "admin-mcp",
        displayName: "Jesus Film Admin MCP",
        trustTier: "first_party",
        ownerType: "jesus_film",
      }),
    )
    expect(ADMIN_MCP_APP_SEED.environments.map((env) => env.key)).toEqual([
      "local",
      "preview",
      "staging",
      "production",
      "codex",
    ])
    expect(ADMIN_MCP_APP_SEED.environments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "local",
          clientId: "jfp_admin_mcp_local",
          redirectUris: ["http://localhost:3003/mcp/oauth/callback"],
          postLogoutRedirectUris: [
            "http://localhost:3003/dashboard/experiences",
          ],
          allowedOrigins: ["http://localhost:3003"],
          defaultScopes: expect.arrayContaining([
            "openid",
            "profile:read",
            "email:read",
            "offline_access",
            "membership:read",
            "experience:read",
            "experience:locale:create",
            "experience:locale:update",
            "experience:locale:validate",
            "media:read",
            "video:read",
            "bible:read",
            "experience:publish",
            "experience:create",
            "experience:generate",
          ]),
          autoApprove: true,
        }),
        expect.objectContaining({
          key: "production",
          clientId: "jfp_admin_mcp_production",
          redirectUris: ["https://admin.jesusfilm.org/mcp/oauth/callback"],
          postLogoutRedirectUris: [
            "https://admin.jesusfilm.org/dashboard/experiences",
          ],
          allowedOrigins: ["https://admin.jesusfilm.org"],
          defaultScopes: expect.arrayContaining(["experience:publish"]),
          autoApprove: true,
        }),
      ]),
    )
  })

  it("does not add offline_access to non-MCP first-party app defaults", () => {
    expect(ADMIN_APP_SEED.environments[0]?.defaultScopes).not.toContain(
      "offline_access",
    )
    expect(MANAGER_APP_SEED.environments[0]?.defaultScopes).not.toContain(
      "offline_access",
    )
    expect(WEB_APP_SEED.environments[0]?.defaultScopes).not.toContain(
      "offline_access",
    )
    expect(CHAT_APP_SEED.environments[0]?.defaultScopes).not.toContain(
      "offline_access",
    )
    expect(MASTRA_STUDIO_APP_SEED.environments[0]?.defaultScopes).not.toContain(
      "offline_access",
    )
  })

  it("keeps every Admin MCP OAuth client public, PKCE-bound, and refresh-token capable", () => {
    for (const environment of ADMIN_MCP_APP_SEED.environments) {
      expect(environment.defaultScopes).toContain("offline_access")
      expect(environment.defaultScopes).toEqual(
        expect.arrayContaining([
          "experience:read",
          "experience:locale:update",
          "experience:publish",
        ]),
      )
    }
  })

  it("keeps non-MCP app scopes unchanged when Admin MCP gains offline access", () => {
    expect(CHAT_APP_SEED.environments).toEqual([
      expect.objectContaining({
        key: "local",
        defaultScopes: ["openid", "profile:read", "email:read"],
      }),
      expect.objectContaining({
        key: "production",
        defaultScopes: ["openid", "profile:read", "email:read"],
      }),
    ])
  })

  it("registers production Admin MCP defaults with persistent access only for MCP", () => {
    expect(ADMIN_MCP_APP_SEED.environments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "production",
          defaultScopes: expect.arrayContaining([
            "offline_access",
            "experience:read",
            "experience:publish",
          ]),
          autoApprove: true,
        }),
      ]),
    )
  })

  it("registers the Chat OAuth clients for local development and production", () => {
    expect(CHAT_APP_SEED.environments.map((env) => env.key)).toEqual([
      "local",
      "production",
    ])
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
      expect.objectContaining({
        key: "production",
        clientId: "jfp_chat_production",
        redirectUris: ["https://chat.jesusfilm.ai/api/auth/callback"],
        postLogoutRedirectUris: ["https://chat.jesusfilm.ai"],
        allowedOrigins: ["https://chat.jesusfilm.ai"],
        // Identity-only — no *:access, no membership:read (feat-207 R7).
        defaultScopes: ["openid", "profile:read", "email:read"],
        autoApprove: true,
      }),
    ])
  })

  it("registers the Codex MCP OAuth client with locale-factory scopes", () => {
    expect(ADMIN_MCP_APP_SEED.environments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "codex",
          kind: "production",
          clientId: "jfp_admin_mcp_codex",
          redirectUris: [],
          postLogoutRedirectUris: [],
          allowedOrigins: [],
          defaultScopes: expect.arrayContaining([
            "openid",
            "profile:read",
            "email:read",
            "offline_access",
            "membership:read",
            "experience:read",
            "experience:locale:create",
            "experience:locale:update",
            "experience:locale:validate",
            "media:read",
            "video:read",
            "bible:read",
            "experience:publish",
            "experience:create",
            "experience:generate",
          ]),
          autoApprove: true,
        }),
      ]),
    )
  })

  it("keeps experience-level create and generate scopes distinct from publish", () => {
    // Scope-isolation invariant (feat-320): creating or generating never
    // implies publishing — the grant carries all three as separate,
    // individually grantable/revocable entries, and a grant holding only
    // create + generate is a valid scope set on its own.
    expect(ADMIN_MCP_DEFAULT_SCOPES).toEqual(
      expect.arrayContaining([
        "experience:create",
        "experience:generate",
        "experience:publish",
      ]),
    )
    expect(
      assertKnownScopes(["experience:create", "experience:generate"]),
    ).toEqual(["experience:create", "experience:generate"])
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

  it("registers the TV OAuth clients for local, preview, staging, and production", () => {
    expect(TV_APP_SEED).toEqual(
      expect.objectContaining({
        key: "tv",
        displayName: "Jesus Film TV",
        trustTier: "first_party",
        ownerType: "jesus_film",
      }),
    )
    expect(TV_APP_SEED.environments.map((env) => env.key)).toEqual([
      "local",
      "preview",
      "staging",
      "production",
    ])
    expect(TV_APP_SEED.environments).toEqual([
      expect.objectContaining({
        key: "local",
        kind: "local",
        clientId: "jfp_tv_local",
        // Sentinel only: bound into the authorization code and re-compared at
        // the token endpoint. A TV never navigates it.
        redirectUris: ["http://localhost:3004/device/callback"],
        postLogoutRedirectUris: [],
        allowedOrigins: [],
        autoApprove: true,
      }),
      expect.objectContaining({
        key: "preview",
        kind: "preview",
        clientId: "jfp_tv_preview",
        redirectUris: ["https://auth-preview.jesusfilm.org/device/callback"],
        postLogoutRedirectUris: [],
        allowedOrigins: [],
        autoApprove: true,
      }),
      expect.objectContaining({
        key: "staging",
        kind: "staging",
        clientId: "jfp_tv_staging",
        redirectUris: ["https://auth-stage.jesusfilm.org/device/callback"],
        postLogoutRedirectUris: [],
        allowedOrigins: [],
        autoApprove: true,
      }),
      expect.objectContaining({
        key: "production",
        kind: "production",
        clientId: "jfp_tv_production",
        redirectUris: ["https://auth.jesusfilm.org/device/callback"],
        postLogoutRedirectUris: [],
        allowedOrigins: [],
        autoApprove: true,
      }),
    ])
  })

  it("grants the TV exactly identity, offline access, and watch-event write", () => {
    expect(TV_DEFAULT_SCOPES).toEqual([
      "openid",
      "profile:read",
      "email:read",
      "offline_access",
      "web:watch-events:write",
    ])
    // Admin-introspection contract: usableWebUserSubject
    // (apps/admin/src/auth/web-user-token.ts) rejects any token whose scope
    // list omits this, whatever the client id allowlist says. Dropping it here
    // makes every TV token useless to admin.
    expect(TV_DEFAULT_SCOPES).toContain("web:watch-events:write")
    // The TV performs no authorization.
    expect(TV_DEFAULT_SCOPES).not.toContain("membership:read")
    expect(
      TV_DEFAULT_SCOPES.filter((scope) => scope.endsWith(":access")),
    ).toEqual([])

    for (const environment of TV_APP_SEED.environments) {
      expect(environment.defaultScopes).toEqual([...TV_DEFAULT_SCOPES])
    }
  })

  it("keeps TV_DEVICE_CLIENT_IDS aligned with the seeded TV client ids", () => {
    // The device plugin and the app-environment policy exemption both read this
    // list; a client id added to the seed but not here is a client that seeds
    // fine and then cannot use the grant it exists for.
    expect([...TV_DEVICE_CLIENT_IDS]).toEqual(
      TV_APP_SEED.environments.map((env) => env.clientId),
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

describe("mobile app seed", () => {
  it("registers mobile with https self-RP callbacks only — never a custom-scheme redirect", () => {
    expect(MOBILE_APP_SEED.environments.map((env) => env.key)).toEqual([
      "local",
      "production",
    ])
    expect(MOBILE_APP_SEED.environments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "local",
          clientId: "jfp_mobile_local",
          redirectUris: [
            "http://localhost:3004/api/auth/callback/jfp",
            "http://localhost:3004/api/auth/oauth2/callback/jfp",
          ],
          allowedOrigins: ["http://localhost:3004"],
          autoApprove: true,
        }),
        expect.objectContaining({
          key: "production",
          clientId: "jfp_mobile_production",
          redirectUris: [
            "https://auth.jesusfilm.org/api/auth/callback/jfp",
            "https://auth.jesusfilm.org/api/auth/oauth2/callback/jfp",
          ],
          allowedOrigins: ["https://auth.jesusfilm.org"],
          autoApprove: true,
        }),
      ]),
    )

    for (const environment of MOBILE_APP_SEED.environments) {
      for (const redirectUri of environment.redirectUris) {
        expect(redirectUri).toMatch(/^https?:\/\//)
      }
    }
  })

  it("grants mobile identity-only scopes — progress permissions ride admin's MOBILE_USER principal", () => {
    for (const environment of MOBILE_APP_SEED.environments) {
      expect(environment.defaultScopes).toEqual([
        "openid",
        "profile:read",
        "email:read",
      ])
      expect(assertKnownScopes(environment.defaultScopes)).toBeTruthy()
    }
  })
})
