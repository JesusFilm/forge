import { describe, expect, it } from "vitest"

import {
  buildAuditEvent,
  hashAuditSubject,
  redactAuditMetadata,
} from "./audit.service"

const DEVICE_CODE = "dc_9f8e7d6c5b4a"
const USER_CODE = "0194507302"

describe("audit metadata redaction", () => {
  it("redacts every device-grant credential in both wire and in-code spellings", () => {
    // Matching is exact and case-sensitive, so each key needs its own entry.
    // Both spellings are asserted here because a partial fix (snake_case only)
    // would still leak `deviceCode`/`userCode` from TypeScript call sites.
    expect(
      redactAuditMetadata({
        codeChallenge: "challenge",
        codeVerifier: "verifier",
        code_challenge: "challenge",
        code_verifier: "verifier",
        deviceCode: DEVICE_CODE,
        deviceCodeHash: hashAuditSubject(DEVICE_CODE),
        device_code: DEVICE_CODE,
        device_code_hash: hashAuditSubject(DEVICE_CODE),
        userCode: USER_CODE,
        userCodeHash: hashAuditSubject(USER_CODE),
        user_code: USER_CODE,
        user_code_hash: hashAuditSubject(USER_CODE),
      }),
    ).toEqual({
      codeChallenge: "[redacted]",
      codeVerifier: "[redacted]",
      code_challenge: "[redacted]",
      code_verifier: "[redacted]",
      deviceCode: "[redacted]",
      deviceCodeHash: "[redacted]",
      device_code: "[redacted]",
      device_code_hash: "[redacted]",
      userCode: "[redacted]",
      userCodeHash: "[redacted]",
      user_code: "[redacted]",
      user_code_hash: "[redacted]",
    })
  })

  it("keeps redacting the pre-existing credential keys", () => {
    expect(
      redactAuditMetadata({
        accessToken: "jfp_at_live",
        access_token: "jfp_at_live",
        authorization: "Bearer jfp_at_live",
        clientSecret: "shh",
        client_secret: "shh",
        code: "authorization-code",
        idToken: "jwt",
        id_token: "jwt",
        password: "hunter2",
        refreshToken: "jfp_rt_live",
        refresh_token: "jfp_rt_live",
        token: "jfp_at_live",
      }),
    ).toEqual({
      accessToken: "[redacted]",
      access_token: "[redacted]",
      authorization: "[redacted]",
      clientSecret: "[redacted]",
      client_secret: "[redacted]",
      code: "[redacted]",
      idToken: "[redacted]",
      id_token: "[redacted]",
      password: "[redacted]",
      refreshToken: "[redacted]",
      refresh_token: "[redacted]",
      token: "[redacted]",
    })
  })

  it("redacts the verification URI that carries the user code in its query", () => {
    // RFC 8628 §3.3.1. The key does not name a credential, but its value is
    // `/device?user_code=<raw code>` — recording the device-code response
    // envelope would otherwise write the code to the audit table in plaintext.
    const redacted = redactAuditMetadata({
      verificationUriComplete: `https://auth.jesusfilm.org/device?user_code=${USER_CODE}`,
      verification_uri_complete: `https://auth.jesusfilm.org/device?user_code=${USER_CODE}`,
      verification_uri: "https://auth.jesusfilm.org/device",
    })

    expect(redacted).toEqual({
      verificationUriComplete: "[redacted]",
      verification_uri_complete: "[redacted]",
      // No code in this one, and operators need it to answer "which host did
      // the TV point the user at" — it stays.
      verification_uri: "https://auth.jesusfilm.org/device",
    })
    expect(JSON.stringify(redacted)).not.toContain(USER_CODE)
  })

  it("redacts the in-code spelling of a minted authorization code", () => {
    // `buildAuthorizationCode` returns `{ code }`, but the plugin holds it as
    // `authorizationCode`; a flattened log of that variable must not leak.
    expect(
      redactAuditMetadata({
        authorizationCode: "Yl9hdXRoX2NvZGU",
        authorization_code: "Yl9hdXRoX2NvZGU",
      }),
    ).toEqual({
      authorizationCode: "[redacted]",
      authorization_code: "[redacted]",
    })
  })

  it("redacts credentials nested inside arrays", () => {
    // An array is a container, never a credential. Passing arrays through
    // untouched left `{ attempts: [{ userCode }] }` leaking in plaintext.
    const redacted = redactAuditMetadata({
      attempts: [
        { outcome: "invalid_grant", userCode: USER_CODE },
        { outcome: "expired_token", userCode: USER_CODE },
      ],
      scopes: ["openid", "web:watch-events:write"],
      nested: [[{ deviceCode: DEVICE_CODE }]],
    })

    expect(redacted).toEqual({
      attempts: [
        { outcome: "invalid_grant", userCode: "[redacted]" },
        { outcome: "expired_token", userCode: "[redacted]" },
      ],
      // Arrays of plain values are untouched — walking only ever redacts keys.
      scopes: ["openid", "web:watch-events:write"],
      nested: [[{ deviceCode: "[redacted]" }]],
    })
    expect(JSON.stringify(redacted)).not.toContain(USER_CODE)
    expect(JSON.stringify(redacted)).not.toContain(DEVICE_CODE)
  })

  it("recurses into nested objects", () => {
    expect(
      redactAuditMetadata({
        request: {
          clientId: "tv",
          deviceCode: DEVICE_CODE,
          pkce: {
            codeVerifier: "verifier",
            method: "S256",
          },
        },
      }),
    ).toEqual({
      request: {
        clientId: "tv",
        deviceCode: "[redacted]",
        pkce: {
          codeVerifier: "[redacted]",
          method: "S256",
        },
      },
    })
  })

  it("passes non-credential keys through untouched", () => {
    // Anti-vacuous companion: if the redactor were changed to redact
    // everything, or to blanket-match any key containing "code"/"Hash", these
    // assertions go red. `tokenHash` in particular is the correlation value
    // `buildTokenRevocationAuditEvent` depends on and must survive.
    expect(
      redactAuditMetadata({
        attemptedClientId: "tv",
        clientId: "tv",
        deviceGrantId: "dg_123",
        grantType: "urn:ietf:params:oauth:grant-type:device_code",
        status: "APPROVED",
        tokenHash: hashAuditSubject("jfp_at_live"),
        tokenHint: "access_token",
      }),
    ).toEqual({
      attemptedClientId: "tv",
      clientId: "tv",
      deviceGrantId: "dg_123",
      grantType: "urn:ietf:params:oauth:grant-type:device_code",
      status: "APPROVED",
      tokenHash: hashAuditSubject("jfp_at_live"),
      tokenHint: "access_token",
    })
  })

  it("redacts through buildAuditEvent, not just the exported helper", () => {
    const event = buildAuditEvent({
      eventType: "device.grant.approved",
      severity: "info",
      actorUserId: "user_123",
      subject: "tv",
      metadata: {
        clientId: "tv",
        deviceCode: DEVICE_CODE,
        userCode: USER_CODE,
      },
    })

    expect(event.metadata).toEqual({
      clientId: "tv",
      deviceCode: "[redacted]",
      userCode: "[redacted]",
    })
    expect(event.severity).toBe("INFO")
  })
})
