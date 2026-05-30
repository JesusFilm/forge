import { describe, expect, it } from "vitest"
import { SignJWT } from "jose"

import {
  createAdminOAuthAccessRequestCookie,
  createAdminOAuthSessionCookie,
  readAdminOAuthAccessRequestCookie,
  readAdminOAuthSessionCookie,
} from "./auth-session"

describe("admin OAuth session cookie", () => {
  it("round-trips a signed principal", async () => {
    const cookie = await createAdminOAuthSessionCookie(
      { id: "user_123", role: "EDITOR" },
      ["admin:access"],
    )

    await expect(readAdminOAuthSessionCookie(cookie)).resolves.toEqual({
      id: "user_123",
      role: "EDITOR",
    })
  })

  it("round-trips a signed access request", async () => {
    const cookie = await createAdminOAuthAccessRequestCookie({
      subject: "subject_123",
      email: "user@example.com",
      name: "Test User",
    })

    await expect(readAdminOAuthAccessRequestCookie(cookie)).resolves.toEqual({
      subject: "subject_123",
      email: "user@example.com",
      name: "Test User",
    })
  })

  it("rejects tampered payloads and malformed signatures", async () => {
    const cookie = await createAdminOAuthSessionCookie(
      { id: "user_123", role: "VIEWER" },
      ["admin:access"],
    )
    const parts = cookie.split(".")
    const tamperedBody = Buffer.from(
      JSON.stringify({
        id: "user_123",
        role: "ADMIN",
        scopes: ["admin:access"],
      }),
    ).toString("base64url")

    await expect(
      readAdminOAuthSessionCookie([parts[0], tamperedBody, parts[2]].join(".")),
    ).resolves.toBeNull()
    await expect(
      readAdminOAuthSessionCookie("not-a-cookie"),
    ).resolves.toBeNull()
  })

  it("rejects invalid signed payload shapes", async () => {
    const cookie = await createAdminOAuthSessionCookie(
      { id: "user_123", role: "VIEWER" },
      ["admin:access"],
    )
    const invalidCookie = await new SignJWT({
      id: "user_123",
      role: "SYSTEM",
      scopes: ["admin:access"],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("60s")
      .sign(new TextEncoder().encode("development-only"))

    await expect(readAdminOAuthSessionCookie(invalidCookie)).resolves.toBeNull()
    await expect(
      readAdminOAuthSessionCookie(`${cookie}.extra`),
    ).resolves.toBeNull()
  })
})
