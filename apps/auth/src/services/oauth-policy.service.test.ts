import { describe, expect, it } from "vitest"

import { authorizeOAuthTokenIssue } from "./oauth-policy.service"

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
