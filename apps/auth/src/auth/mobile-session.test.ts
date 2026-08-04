import { describe, expect, it } from "vitest"

import {
  MOBILE_CLIENT_CLAIM,
  MOBILE_SESSION_CLIENT_KIND,
  defineMobileAwareJwtPayload,
  resolveSessionClientKind,
} from "./mobile-session"

describe("resolveSessionClientKind", () => {
  it("stamps native Apple idToken sign-ins as mobile", () => {
    expect(
      resolveSessionClientKind({
        path: "/sign-in/social",
        body: { provider: "apple", idToken: { token: "apple-identity-token" } },
      }),
    ).toBe(MOBILE_SESSION_CLIENT_KIND)
  })

  it("stamps native Google idToken sign-ins as mobile", () => {
    expect(
      resolveSessionClientKind({
        path: "/sign-in/social",
        body: {
          provider: "google",
          idToken: { token: "google-identity-token" },
        },
      }),
    ).toBe(MOBILE_SESSION_CLIENT_KIND)
  })

  it("stamps the jfp self-RP hosted-fallback callback as mobile", () => {
    expect(resolveSessionClientKind({ path: "/oauth2/callback/jfp" })).toBe(
      MOBILE_SESSION_CLIENT_KIND,
    )
  })

  it("does not stamp browser social sign-ins without an idToken", () => {
    expect(
      resolveSessionClientKind({
        path: "/sign-in/social",
        body: { provider: "google", callbackURL: "/watch" },
      }),
    ).toBeUndefined()
  })

  it("does not stamp web browser provider callbacks", () => {
    expect(
      resolveSessionClientKind({ path: "/callback/google" }),
    ).toBeUndefined()
  })

  it("does not stamp email sign-ins", () => {
    expect(
      resolveSessionClientKind({
        path: "/sign-in/email",
        body: { email: "person@example.com", password: "pw" },
      }),
    ).toBeUndefined()
  })

  it("does not stamp other generic-oauth provider callbacks", () => {
    expect(
      resolveSessionClientKind({ path: "/oauth2/callback/okta" }),
    ).toBeUndefined()
  })

  it("does not stamp agent-login sessions", () => {
    expect(
      resolveSessionClientKind({ path: "/agent-login/redeem" }),
    ).toBeUndefined()
  })

  it("does not stamp idToken sign-ins from providers without native sheets", () => {
    expect(
      resolveSessionClientKind({
        path: "/sign-in/social",
        body: { provider: "facebook", idToken: { token: "t" } },
      }),
    ).toBeUndefined()
  })

  it("handles a missing context without stamping", () => {
    expect(resolveSessionClientKind(undefined)).toBeUndefined()
    expect(resolveSessionClientKind({})).toBeUndefined()
    expect(
      resolveSessionClientKind({ path: "/sign-in/social", body: null }),
    ).toBeUndefined()
  })
})

describe("defineMobileAwareJwtPayload", () => {
  it("carries the mobile client claim for mobile-stamped sessions", () => {
    expect(
      defineMobileAwareJwtPayload({
        user: { id: "user-1" },
        session: { clientKind: MOBILE_SESSION_CLIENT_KIND },
      }),
    ).toEqual({
      sub: "user-1",
      [MOBILE_CLIENT_CLAIM]: MOBILE_SESSION_CLIENT_KIND,
    })
  })

  it("omits the client claim for unstamped sessions", () => {
    expect(
      defineMobileAwareJwtPayload({
        user: { id: "user-2" },
        session: {},
      }),
    ).toEqual({ sub: "user-2" })
  })

  it("never includes email or name in the payload", () => {
    const payload = defineMobileAwareJwtPayload({
      user: {
        id: "user-3",
        email: "person@example.com",
        name: "Person",
      } as { id: string },
      session: { clientKind: MOBILE_SESSION_CLIENT_KIND },
    })

    expect(Object.keys(payload).sort()).toEqual(
      ["sub", MOBILE_CLIENT_CLAIM].sort(),
    )
  })
})

describe("resolveSessionClientKind — route-pattern contexts", () => {
  it("stamps the jfp callback when the context carries the route pattern plus params", () => {
    expect(
      resolveSessionClientKind({
        path: "/oauth2/callback/:providerId",
        params: { providerId: "jfp" },
      }),
    ).toBe(MOBILE_SESSION_CLIENT_KIND)
  })

  it("does not stamp other providers under the route-pattern path", () => {
    expect(
      resolveSessionClientKind({
        path: "/oauth2/callback/:providerId",
        params: { providerId: "okta" },
      }),
    ).toBeUndefined()
  })
})
