import { describe, expect, it } from "vitest"

import {
  assertCanRevokeToken,
  buildTokenRevocationAuditEvent,
  normalizeTokenHint,
} from "./revocation.service"

describe("token revocation policy", () => {
  it("normalizes supported token hints", () => {
    expect(normalizeTokenHint("access_token")).toBe("access_token")
    expect(normalizeTokenHint("refresh_token")).toBe("refresh_token")
    expect(normalizeTokenHint("made_up")).toBeUndefined()
    expect(normalizeTokenHint(null)).toBeUndefined()
  })

  it("allows same-client revocation and rejects cross-client revocation", () => {
    expect(() =>
      assertCanRevokeToken({
        requesterClientId: "admin",
        tokenClientId: "admin",
        tokenStatus: "active",
      }),
    ).not.toThrow()

    expect(() =>
      assertCanRevokeToken({
        requesterClientId: "admin",
        tokenClientId: "web",
        tokenStatus: "active",
      }),
    ).toThrow("OAuth clients can only revoke tokens issued to themselves.")
  })

  it("redacts raw tokens in audit metadata", () => {
    const event = buildTokenRevocationAuditEvent({
      actorUserId: "user_123",
      appId: "app_123",
      clientId: "admin",
      token: "secret-token",
      tokenHint: "access_token",
    })

    expect(event.metadata).toMatchObject({
      clientId: "admin",
      token: "[redacted]",
      tokenHint: "access_token",
    })
    expect(event.metadata.tokenHash).toHaveLength(64)
  })
})
