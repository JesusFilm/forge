// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  ANON_ID_TTL_SECONDS,
  CHAT_ANON_ID_COOKIE,
  getCookieValue,
  isValidAnonId,
  resolveSeekerResource,
  serializeAnonIdCookie,
} from "./anon-id"

const VALID_UUID = "0f6d3f1e-1111-4a2b-8c3d-000000000042"

describe("isValidAnonId", () => {
  it("accepts a UUID and rejects everything else", () => {
    expect(isValidAnonId(VALID_UUID)).toBe(true)
    expect(isValidAnonId(crypto.randomUUID())).toBe(true)
    for (const bad of [
      undefined,
      null,
      "",
      "not-a-uuid",
      // Injection shapes a client-settable cookie could carry:
      "user:someone-else",
      `${VALID_UUID}; Path=/`,
      `${VALID_UUID}x`,
      42,
    ]) {
      expect(isValidAnonId(bad)).toBe(false)
    }
  })

  it("covenant (tighten-only, lib/conversation-id): the cookie trust gate still rejects non-UUID shapes a loosened URL-id pattern might admit", () => {
    // UUID_PATTERN is shared with the /c/<id> URL surface (feat-209). If it
    // were ever relaxed for URL ids, these must fail HERE, at the cookie
    // boundary — loudly, not silently pass.
    for (const nonUuid of [
      "thread_abc123",
      "0f6d3f1e11114a2b8c3d000000000042", // un-hyphenated 32-hex near-miss
      "0f6d3f1e-1111-4a2b-8c3d-00000000004", // 35-char near-miss
    ]) {
      expect(isValidAnonId(nonUuid)).toBe(false)
    }
  })
})

describe("getCookieValue", () => {
  it("finds a named cookie among several", () => {
    const header = `a=1; ${CHAT_ANON_ID_COOKIE}=${VALID_UUID}; b=2`
    expect(getCookieValue(header, CHAT_ANON_ID_COOKIE)).toBe(VALID_UUID)
  })

  it("returns undefined for a missing cookie or header", () => {
    expect(getCookieValue("a=1; b=2", CHAT_ANON_ID_COOKIE)).toBeUndefined()
    expect(getCookieValue(null, CHAT_ANON_ID_COOKIE)).toBeUndefined()
    expect(getCookieValue(undefined, CHAT_ANON_ID_COOKIE)).toBeUndefined()
  })

  it("does not match a cookie whose name merely ends with the target", () => {
    expect(
      getCookieValue(`x_${CHAT_ANON_ID_COOKIE}=evil`, CHAT_ANON_ID_COOKIE),
    ).toBeUndefined()
  })
})

describe("serializeAnonIdCookie", () => {
  it("carries the hardened attributes and the rolling 25-day Max-Age", () => {
    const cookie = serializeAnonIdCookie(VALID_UUID)
    expect(cookie).toContain(`${CHAT_ANON_ID_COOKIE}=${VALID_UUID}`)
    expect(cookie).toContain("Path=/")
    expect(cookie).toContain(`Max-Age=${ANON_ID_TTL_SECONDS}`)
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=Lax")
    // Host-only by construction: no Domain attribute, ever.
    expect(cookie).not.toContain("Domain")
    // 25 days — aligned with the flat ai-chat retention window (feat-336).
    expect(ANON_ID_TTL_SECONDS).toBe(25 * 24 * 60 * 60)
  })
})

describe("resolveSeekerResource", () => {
  it("uses user:<sub> when signed in and issues no anon cookie", () => {
    const resolution = resolveSeekerResource({
      identity: { sub: "auth0|abc:def" },
      anonCookieValue: VALID_UUID,
    })
    // The sub is used verbatim after the prefix — consumers prefix-check only,
    // never split on ":" (a sub may contain anything).
    expect(resolution).toEqual({ resourceId: "user:auth0|abc:def" })
  })

  it("treats an empty/blank sub as anonymous (never a bare `user:` partition)", () => {
    // A malformed identity must not collapse onto the shared `user:` partition —
    // it falls through to a fresh anon id instead.
    for (const sub of ["", "   "]) {
      const resolution = resolveSeekerResource({
        identity: { sub },
        anonCookieValue: undefined,
        mintId: () => VALID_UUID,
      })
      expect(resolution.resourceId).toBe(`anon:${VALID_UUID}`)
    }
  })

  it("reuses AND re-issues a valid anon id (rolling lifetime, day-31 case)", () => {
    // The day-31 active anonymous user: their threads are still live (rolling
    // retention) so their identifier must roll too — same value, re-set.
    const resolution = resolveSeekerResource({
      identity: null,
      anonCookieValue: VALID_UUID,
    })
    expect(resolution).toEqual({
      resourceId: `anon:${VALID_UUID}`,
      anonIdToSet: VALID_UUID,
    })
  })

  it("mints a fresh id when the cookie is absent", () => {
    const resolution = resolveSeekerResource({
      identity: null,
      anonCookieValue: undefined,
      mintId: () => VALID_UUID,
    })
    expect(resolution).toEqual({
      resourceId: `anon:${VALID_UUID}`,
      anonIdToSet: VALID_UUID,
    })
  })

  it("discards an invalid cookie value and re-mints (never trusts the client)", () => {
    const resolution = resolveSeekerResource({
      identity: null,
      // A client-settable cookie trying to impersonate a user resource.
      anonCookieValue: "user:victim-sub",
      mintId: () => VALID_UUID,
    })
    expect(resolution.resourceId).toBe(`anon:${VALID_UUID}`)
    expect(resolution.anonIdToSet).toBe(VALID_UUID)
  })

  it("minted ids are valid UUIDs by default", () => {
    const resolution = resolveSeekerResource({
      identity: null,
      anonCookieValue: undefined,
    })
    expect(resolution.resourceId.startsWith("anon:")).toBe(true)
    expect(isValidAnonId(resolution.anonIdToSet)).toBe(true)
  })
})
