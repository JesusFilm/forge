import { describe, expect, it } from "vitest"

import {
  authorizeOAuthTokenIssue,
  decideChangelogOAuthScopes,
  resolveChangelogOAuthTarget,
} from "./oauth-policy.service"

const baseInput = {
  family: "user_delegated" as const,
  requestedScopes: ["openid", "admin:access"],
  grantedScopes: ["openid", "admin:access"],
  environmentKind: "production" as const,
  audience: "https://admin.jesusfilm.org",
  expiresAt: new Date("2026-05-11T01:00:00.000Z"),
  now: new Date("2026-05-11T00:00:00.000Z"),
  userId: "user_123",
  membershipStatus: "active" as const,
  appStatus: "active" as const,
  environmentStatus: "approved" as const,
  grantStatus: "approved" as const,
}

describe("OAuth token issue policy", () => {
  it("returns the approved token decision for a valid request", () => {
    expect(authorizeOAuthTokenIssue(baseInput)).toEqual({
      audience: "https://admin.jesusfilm.org",
      scopes: ["openid", "admin:access"],
      family: "user_delegated",
    })
  })

  it("rejects inactive user-delegated memberships", () => {
    expect(() =>
      authorizeOAuthTokenIssue({
        ...baseInput,
        membershipStatus: "suspended",
      }),
    ).toThrow("Active membership is required for user-delegated tokens.")
  })

  it("rejects suspended apps and revoked grants", () => {
    expect(() =>
      authorizeOAuthTokenIssue({
        ...baseInput,
        appStatus: "suspended",
      }),
    ).toThrow("Registered app status 'suspended' cannot issue tokens.")

    expect(() =>
      authorizeOAuthTokenIssue({
        ...baseInput,
        grantStatus: "revoked",
      }),
    ).toThrow("App grant status 'revoked' cannot issue tokens.")
  })
})

describe("Changelog OAuth policy", () => {
  it.each([
    { granted: [], expected: ["openid"] },
    { granted: ["changelog:read"], expected: ["openid", "changelog:read"] },
    {
      granted: ["changelog:submit"],
      expected: ["openid", "changelog:read", "changelog:submit"],
    },
    {
      granted: ["changelog:admin"],
      expected: [
        "openid",
        "changelog:read",
        "changelog:submit",
        "changelog:admin",
      ],
    },
  ])("downscopes authorization to the $granted grant bundle", (testCase) => {
    expect(
      decideChangelogOAuthScopes({
        lifecycle: "authorization",
        requestedScopes: [
          "openid",
          "changelog:read",
          "changelog:submit",
          "changelog:admin",
        ],
        grantedScopes: testCase.granted,
        environmentKind: "local",
        dynamicClient: false,
        productionEnabled: false,
      }),
    ).toEqual({ allowed: true, scopes: testCase.expected })
  })

  it("preserves baseline order, deduplicates, and never widens the request", () => {
    expect(
      decideChangelogOAuthScopes({
        lifecycle: "authorization",
        requestedScopes: [
          "email:read",
          "openid",
          "email:read",
          "changelog:submit",
        ],
        grantedScopes: ["changelog:admin", "changelog:read", "unrelated:scope"],
        environmentKind: "local",
        dynamicClient: false,
        productionEnabled: false,
      }),
    ).toEqual({
      allowed: true,
      scopes: ["email:read", "openid", "changelog:submit"],
    })
  })

  it("requires changelog:read for dynamic authorization", () => {
    expect(
      decideChangelogOAuthScopes({
        lifecycle: "authorization",
        requestedScopes: ["openid", "changelog:submit"],
        grantedScopes: [],
        environmentKind: "local",
        dynamicClient: true,
        productionEnabled: false,
      }),
    ).toEqual({ allowed: false, reason: "changelog_access_denied" })
  })

  it("rejects a reduced exchange or refresh and keeps the original ceiling", () => {
    expect(
      decideChangelogOAuthScopes({
        lifecycle: "exchange",
        requestedScopes: ["openid", "changelog:read", "changelog:submit"],
        scopeCeiling: ["openid", "changelog:read", "changelog:submit"],
        grantedScopes: ["changelog:read"],
        environmentKind: "local",
        dynamicClient: true,
        productionEnabled: false,
      }),
    ).toEqual({ allowed: false, reason: "changelog_grant_changed" })

    expect(
      decideChangelogOAuthScopes({
        lifecycle: "refresh",
        requestedScopes: ["openid", "changelog:read", "changelog:admin"],
        scopeCeiling: ["openid", "changelog:read"],
        grantedScopes: ["changelog:admin"],
        environmentKind: "local",
        dynamicClient: true,
        productionEnabled: false,
      }),
    ).toEqual({ allowed: true, scopes: ["openid", "changelog:read"] })
  })

  it("fails production closed while activation is disabled", () => {
    expect(
      decideChangelogOAuthScopes({
        lifecycle: "authorization",
        requestedScopes: ["openid", "changelog:read"],
        grantedScopes: ["changelog:admin"],
        environmentKind: "production",
        dynamicClient: false,
        productionEnabled: false,
      }),
    ).toEqual({ allowed: true, scopes: ["openid"] })

    expect(
      decideChangelogOAuthScopes({
        lifecycle: "refresh",
        requestedScopes: ["openid", "changelog:read"],
        scopeCeiling: ["openid", "changelog:read"],
        grantedScopes: ["changelog:admin"],
        environmentKind: "production",
        dynamicClient: true,
        productionEnabled: false,
      }),
    ).toEqual({ allowed: false, reason: "changelog_grant_changed" })

    expect(
      decideChangelogOAuthScopes({
        lifecycle: "authorization",
        requestedScopes: ["openid", "changelog:read"],
        grantedScopes: ["changelog:read"],
        environmentKind: "production",
        dynamicClient: true,
        productionEnabled: true,
      }),
    ).toEqual({ allowed: true, scopes: ["openid", "changelog:read"] })
  })

  it.each([
    { resources: [] },
    {
      resources: ["http://localhost:3000/mcp", "http://localhost:3000/mcp"],
    },
    {
      resources: [
        "http://localhost:3000/mcp",
        "https://changelog.jesusfilm.org/mcp",
      ],
    },
    { resources: ["http://localhost:3000/mcp/"] },
    { resources: ["http://localhost:3000/mcp?environment=production"] },
    { resources: ["http://localhost:3000/mcp#fragment"] },
    { resources: ["HTTP://LOCALHOST:3000/mcp"] },
    { resources: ["http://localhost:3000/%6dcp"] },
    { resources: ["http://127.0.0.1:3000/mcp"] },
    { resources: ["https://unknown.example/mcp"] },
  ])("rejects a dynamic target with resources $resources", ({ resources }) => {
    expect(
      resolveChangelogOAuthTarget({
        seededEnvironmentKind: null,
        resources,
      }),
    ).toEqual({ allowed: false, reason: "invalid_changelog_target" })
  })

  it("resolves exact dynamic resources and rejects seeded conflicts", () => {
    expect(
      resolveChangelogOAuthTarget({
        seededEnvironmentKind: null,
        resources: ["http://localhost:3000/mcp"],
      }),
    ).toEqual({
      allowed: true,
      dynamicClient: true,
      environmentKind: "local",
      resource: "http://localhost:3000/mcp",
    })

    expect(
      resolveChangelogOAuthTarget({
        seededEnvironmentKind: null,
        resources: ["https://changelog.jesusfilm.org/mcp"],
      }),
    ).toEqual({
      allowed: true,
      dynamicClient: true,
      environmentKind: "production",
      resource: "https://changelog.jesusfilm.org/mcp",
    })

    expect(
      resolveChangelogOAuthTarget({
        seededEnvironmentKind: "production",
        resources: [],
      }),
    ).toEqual({
      allowed: true,
      dynamicClient: false,
      environmentKind: "production",
      resource: null,
    })

    expect(
      resolveChangelogOAuthTarget({
        seededEnvironmentKind: "production",
        resources: ["http://localhost:3000/mcp"],
      }),
    ).toEqual({ allowed: false, reason: "invalid_changelog_target" })
  })
})
