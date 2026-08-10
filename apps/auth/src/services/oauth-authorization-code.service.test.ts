import { createHash, webcrypto } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  authorizationCodeIdentifier,
  buildAuthorizationCode,
} from "./oauth-authorization-code.service"

/**
 * Unpadded base64url of a digest, built from first principles rather than from
 * `node:crypto`'s own `"base64url"` encoding — otherwise this would be checking
 * Node against itself.
 */
async function expectedIdentifier(code: string): Promise<string> {
  const digest = new Uint8Array(
    await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(code)),
  )
  return Buffer.from(digest)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

describe("authorization code identifier", () => {
  /**
   * The load-bearing test here.
   *
   * `@better-auth/oauth-provider` finds our authorization code by
   * `defaultHasher(code)` = `base64Url.encode(sha256(code), {padding: false})`.
   * That function is private and `@better-auth/utils` is not a direct dependency
   * of this app, so this pins the algorithm independently. The complementary
   * half — that the library actually accepts what we mint — is asserted end to
   * end in device-grant.integration.test.ts against a real database. Neither
   * test alone is sufficient: this one would still pass if the library changed
   * its scheme, and that one only runs opt-in.
   */
  it("is unpadded base64url of the sha256 digest", async () => {
    for (const code of [
      "simple",
      "with-dashes-and_underscores",
      "0123456789abcdefABCDEF",
      "ünïcodé-ø",
      "a".repeat(256),
    ]) {
      expect(authorizationCodeIdentifier(code)).toBe(
        await expectedIdentifier(code),
      )
    }
  })

  it("produces unpadded base64url, never standard base64", () => {
    const identifier = authorizationCodeIdentifier("code")
    expect(identifier).not.toContain("=")
    expect(identifier).not.toContain("+")
    expect(identifier).not.toContain("/")
    expect(identifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("is deterministic, because it is a lookup key", () => {
    expect(authorizationCodeIdentifier("x")).toBe(
      authorizationCodeIdentifier("x"),
    )
    expect(authorizationCodeIdentifier("x")).not.toBe(
      authorizationCodeIdentifier("y"),
    )
  })

  it("would fail if the encoding silently became hex", () => {
    // Anti-vacuous guard: pins that the assertion above can distinguish
    // encodings at all.
    const hex = createHash("sha256").update("code").digest("hex")
    expect(authorizationCodeIdentifier("code")).not.toBe(hex)
  })
})

describe("buildAuthorizationCode", () => {
  const now = new Date("2026-08-06T12:00:00.000Z")
  const input = {
    query: {
      client_id: "jfp_tv_production",
      redirect_uri: "https://auth.jesusfilm.org/device/callback",
      scope: "openid web:watch-events:write",
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
    },
    userId: "user_1",
    sessionId: "sess_1",
    codeExpiresInMs: 60_000,
    now,
  }

  it("writes the shape the provider parses back out", () => {
    const minted = buildAuthorizationCode(input)
    const parsed = JSON.parse(minted.value) as Record<string, unknown>

    expect(parsed.type).toBe("authorization_code")
    expect(parsed.userId).toBe("user_1")
    expect(parsed.sessionId).toBe("sess_1")
    expect(parsed.query).toEqual(input.query)
    expect(typeof parsed.authTime).toBe("number")
  })

  it("binds client_id, scope and PKCE into the code itself", () => {
    // This is what makes the device grant immune to the drift that produced a
    // real IdP account-takeover: nothing is re-derived at exchange time, so
    // there is no second place for these to disagree.
    const parsed = JSON.parse(buildAuthorizationCode(input).value) as {
      query: Record<string, string>
    }
    expect(parsed.query.client_id).toBe("jfp_tv_production")
    expect(parsed.query.scope).toBe("openid web:watch-events:write")
    expect(parsed.query.code_challenge).toBe("c".repeat(43))
    expect(parsed.query.code_challenge_method).toBe("S256")
  })

  it("writes authTime in milliseconds, the unit the library reads", () => {
    // Seconds here put auth_time in January 1970, and the value is copied onto
    // the refresh token, so every subsequent refresh carries it too. The
    // library's own producer writes `new Date(...).getTime()` and its consumer
    // parses a number as ms.
    const parsed = JSON.parse(buildAuthorizationCode(input).value) as {
      authTime: number
    }

    expect(parsed.authTime).toBe(now.getTime())
    // The discriminating assertion: a seconds value round-trips to 1970.
    expect(new Date(parsed.authTime).getUTCFullYear()).toBe(
      now.getUTCFullYear(),
    )
  })

  it("expires the code on the configured budget", () => {
    const minted = buildAuthorizationCode(input)
    expect(minted.expiresAt.getTime() - now.getTime()).toBe(60_000)
  })

  it("mints a fresh, high-entropy code every call", () => {
    const codes = new Set(
      Array.from({ length: 50 }, () => buildAuthorizationCode(input).code),
    )
    expect(codes.size).toBe(50)
    for (const code of codes) {
      expect(code).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    }
  })

  it("derives the identifier from the code it returns", () => {
    const minted = buildAuthorizationCode(input)
    expect(minted.identifier).toBe(authorizationCodeIdentifier(minted.code))
    // The raw code must never be what lands in the database.
    expect(minted.identifier).not.toBe(minted.code)
  })
})
