import { describe, expect, it } from "vitest"

import {
  MOBILE_CLIENT_CLAIM,
  MOBILE_SESSION_CLIENT_KIND,
  defineMobileAwareJwtPayload,
  resolveSessionClientKind,
} from "./mobile-session"

/** Minimal Headers stand-in — only `get` is read. */
function headers(values: Record<string, string>) {
  return {
    get: (name: string) => values[name.toLowerCase()] ?? null,
  }
}

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
    expect(resolveSessionClientKind({ path: "/callback/jfp" })).toBe(
      MOBILE_SESSION_CLIENT_KIND,
    )
  })

  // 1.7's core callback is `/callback/:id`, so the hook sees that PATTERN and
  // `params.id`, not `params.providerId`. Missing it left every post-upgrade
  // mobile session unstamped, so its JWT carried no mobile claim.
  it("stamps the 1.7 core callback pattern as mobile when params.id is jfp", () => {
    expect(
      resolveSessionClientKind({
        path: "/callback/:id",
        params: { id: "jfp" },
      }),
    ).toBe(MOBILE_SESSION_CLIENT_KIND)
  })

  it("does not stamp another provider on the core callback pattern", () => {
    expect(
      resolveSessionClientKind({
        path: "/callback/:id",
        params: { id: "google" },
      }),
    ).toBeUndefined()
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

  it("does not stamp email sign-ins from the web page", () => {
    // Same endpoint the mobile app uses, so the origin — not the path —
    // is what separates them.
    expect(
      resolveSessionClientKind({
        path: "/sign-in/email",
        body: { email: "person@example.com", password: "pw" },
        headers: headers({ origin: "https://auth.jesusfilm.org" }),
      }),
    ).toBeUndefined()
  })

  it("does not stamp email sign-ins with no origin at all", () => {
    expect(
      resolveSessionClientKind({
        path: "/sign-in/email",
        body: { email: "person@example.com", password: "pw" },
      }),
    ).toBeUndefined()
  })

  it("stamps email sign-in from the mobile app scheme", () => {
    // Without this the user signs in fine but the JWT carries no client
    // claim, so admin rejects every progress call — a silent half-failure.
    expect(
      resolveSessionClientKind({
        path: "/sign-in/email",
        body: { email: "person@example.com", password: "pw" },
        headers: headers({ "expo-origin": "forgemobile://" }),
      }),
    ).toBe("mobile")
  })

  it("stamps email SIGN-UP from the mobile app scheme", () => {
    expect(
      resolveSessionClientKind({
        path: "/sign-up/email",
        body: { email: "new@example.com", password: "pw" },
        headers: headers({ "expo-origin": "forgemobile://" }),
      }),
    ).toBe("mobile")
  })

  it("reads the origin the expo plugin rewrites as well as the raw header", () => {
    // The server plugin copies expo-origin into origin; the stamp must not
    // depend on which of the two ran first.
    expect(
      resolveSessionClientKind({
        path: "/sign-in/email",
        body: {},
        headers: headers({ origin: "forgemobile://" }),
      }),
    ).toBe("mobile")
  })

  it("reads headers off ctx.request when they are not hoisted onto ctx", () => {
    expect(
      resolveSessionClientKind({
        path: "/sign-in/email",
        body: {},
        request: { headers: headers({ origin: "forgemobile://" }) },
      }),
    ).toBe("mobile")
  })

  it("does not stamp a scheme that merely starts like the mobile one", () => {
    expect(
      resolveSessionClientKind({
        path: "/sign-in/email",
        body: {},
        headers: headers({ origin: "forgemobileevil://" }),
      }),
    ).toBeUndefined()
  })

  it("does not stamp non-credential paths on the mobile origin", () => {
    // The origin widens exactly two shared endpoints, not the whole surface.
    expect(
      resolveSessionClientKind({
        path: "/sign-in/username",
        body: {},
        headers: headers({ origin: "forgemobile://" }),
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

describe("resolveSessionClientKind — retired pre-1.7 routes", () => {
  // The pinned 1.7 server never serves /oauth2/callback; the stamp dropped
  // those branches, so even a jfp-shaped legacy context stays unstamped.
  it("does not stamp the retired /oauth2/callback pattern", () => {
    expect(
      resolveSessionClientKind({
        path: "/oauth2/callback/:providerId",
        params: { providerId: "jfp" },
      }),
    ).toBeUndefined()
  })
})
