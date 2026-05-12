import { describe, expect, it } from "vitest"

import { assertTokenPolicy, isProductionAudience } from "./token-policy.service"

const now = new Date("2026-05-11T00:00:00.000Z")
const future = new Date("2026-05-11T01:00:00.000Z")

describe("token policy", () => {
  it("accepts scoped user-delegated production tokens in production", () => {
    expect(() =>
      assertTokenPolicy({
        family: "user_delegated",
        requestedScopes: ["openid", "admin:access"],
        grantedScopes: ["openid", "admin:access", "email:read"],
        environmentKind: "production",
        audience: "https://admin.jesusfilm.org",
        expiresAt: future,
        now,
        userId: "user_123",
      }),
    ).not.toThrow()
  })

  it("rejects non-production tokens for production audiences", () => {
    expect(() =>
      assertTokenPolicy({
        family: "user_delegated",
        requestedScopes: ["openid"],
        grantedScopes: ["openid"],
        environmentKind: "staging",
        audience: "https://admin.jesusfilm.org",
        expiresAt: future,
        now,
        userId: "user_123",
      }),
    ).toThrow(
      "Non-production environments cannot request production audiences.",
    )
  })

  it("rejects scopes outside the grant", () => {
    expect(() =>
      assertTokenPolicy({
        family: "client_credentials",
        requestedScopes: ["openid", "admin:content:write"],
        grantedScopes: ["openid"],
        environmentKind: "local",
        audience: "http://localhost:3003",
        expiresAt: future,
        now,
        serviceKey: "admin-sync",
      }),
    ).toThrow("Requested scope(s) not granted: admin:content:write")
  })

  it("requires matching token subjects", () => {
    expect(() =>
      assertTokenPolicy({
        family: "client_credentials",
        requestedScopes: ["openid"],
        grantedScopes: ["openid"],
        environmentKind: "local",
        audience: "http://localhost:3003",
        expiresAt: future,
        now,
      }),
    ).toThrow("Client-credentials tokens require a service key.")
  })

  it("detects production Jesus Film audiences", () => {
    expect(isProductionAudience("https://admin.jesusfilm.org")).toBe(true)
    expect(isProductionAudience("https://jesusfilm.org")).toBe(true)
    expect(isProductionAudience("http://localhost:3003")).toBe(false)
  })
})
