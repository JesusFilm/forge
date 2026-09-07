import { describe, expect, it } from "vitest"

import { mobileAwareExpoPlugin } from "./mobile-expo-plugin"

// The endpoint is real (better-call builds the cookie/redirect helpers), so the
// path, method, query schema, and every origin-gate branch are under test. Only
// the auth context is faked: base URL, secret, and the cookie factory.
const BASE_URL = "http://localhost:3004/api/auth"
const SELF_RP_CLIENT_ID = "jfp_mobile_local"
const SELF_RP_AUTHORIZE =
  `${BASE_URL}/oauth2/authorize?client_id=${SELF_RP_CLIENT_ID}` +
  "&redirect_uri=http%3A%2F%2Flocalhost%3A3004%2Fapi%2Fauth%2Fcallback%2Fjfp" +
  "&response_type=code&state=state-123"

function plugin() {
  return mobileAwareExpoPlugin({ selfRpClientId: SELF_RP_CLIENT_ID })
}

function proxy(query: Record<string, string>, baseURL = BASE_URL) {
  return plugin().endpoints.expoAuthorizationProxy({
    query,
    context: {
      baseURL,
      secret: "test-secret-with-at-least-thirty-two-chars",
      createAuthCookie: (name: string, options?: { maxAge?: number }) => ({
        name: `better-auth.${name}`,
        attributes: { path: "/", httpOnly: true, sameSite: "lax", ...options },
      }),
    },
    asResponse: true,
  } as never) as Promise<Response>
}

describe("mobileAwareExpoPlugin", () => {
  it("keeps the upstream expo plugin's identity, hooks, and request override", () => {
    const wrapped = plugin()
    expect(wrapped.id).toBe("expo")
    expect(typeof wrapped.onRequest).toBe("function")
    expect(wrapped.hooks?.after?.length).toBeGreaterThan(0)
  })

  it("replaces the authorization proxy under the same key, path, and method", () => {
    const endpoint = plugin().endpoints.expoAuthorizationProxy
    expect(endpoint.path).toBe("/expo-authorization-proxy")
    expect(endpoint.options.method).toBe("GET")
  })

  it("admits this server's own authorize URL for the mobile self-RP client", async () => {
    const response = await proxy({ authorizationURL: SELF_RP_AUTHORIZE })

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(SELF_RP_AUTHORIZE)
    // The browser needs the signed state cookie: the callback compares it
    // against the `state` query parameter and rejects a session without it.
    expect(response.headers.get("set-cookie")).toMatch(
      /better-auth\.state=state-123\./,
    )
  })

  it("rejects the same authorize path for any other client", async () => {
    const response = await proxy({
      authorizationURL: SELF_RP_AUTHORIZE.replace(
        SELF_RP_CLIENT_ID,
        "jfp_admin_local",
      ),
    })
    expect(response.status).toBe(400)
  })

  it("rejects every other same-origin path — the login-CSRF vector upstream closed", async () => {
    for (const path of [
      "/callback/google?state=state-123",
      "/oauth2/authorize/../callback/google?state=state-123",
      "/sign-out?state=state-123",
    ]) {
      const response = await proxy({ authorizationURL: `${BASE_URL}${path}` })
      expect(response.status, path).toBe(400)
    }
  })

  // Every fixture above is http, which the protocol rule alone rejects; only
  // an https base isolates the origin check that closes login-CSRF.
  it("rejects a same-origin non-self-RP path on an https base", async () => {
    const httpsBase = "https://auth.jesusfilm.org/api/auth"
    const rejected = await proxy(
      { authorizationURL: `${httpsBase}/callback/google?state=attacker` },
      httpsBase,
    )
    expect(rejected.status).toBe(400)

    const admitted = await proxy(
      {
        authorizationURL: `${httpsBase}/oauth2/authorize?client_id=${SELF_RP_CLIENT_ID}&state=s-1`,
      },
      httpsBase,
    )
    expect(admitted.status).toBe(302)
    expect(admitted.headers.get("set-cookie")).toMatch(
      /better-auth\.state=s-1\./,
    )
  })

  it("keeps upstream's rules for third-party identity providers", async () => {
    const foreign = "https://accounts.google.com/o/oauth2/v2/auth?state=g-1"
    const allowed = await proxy({ authorizationURL: foreign })
    expect(allowed.status).toBe(302)
    expect(allowed.headers.get("location")).toBe(foreign)
    expect(allowed.headers.get("set-cookie")).toMatch(
      /better-auth\.state=g-1\./,
    )

    const plainHttp = await proxy({
      authorizationURL: "http://accounts.example/auth?state=g-1",
    })
    expect(plainHttp.status).toBe(400)

    const fragment = await proxy({ authorizationURL: `${foreign}#frag` })
    expect(fragment.status).toBe(400)

    const unparseable = await proxy({ authorizationURL: "not a url" })
    expect(unparseable.status).toBe(400)
  })

  it("rejects an authorize URL that carries no state", async () => {
    const response = await proxy({
      authorizationURL: SELF_RP_AUTHORIZE.replace("&state=state-123", ""),
    })
    expect(response.status).toBe(400)
  })

  it("stores an explicit oauthState in the cookie-strategy cookie instead", async () => {
    const response = await proxy({
      authorizationURL: SELF_RP_AUTHORIZE,
      oauthState: "encrypted-state-blob",
    })

    expect(response.status).toBe(302)
    expect(response.headers.get("set-cookie")).toMatch(
      /better-auth\.oauth_state=encrypted-state-blob;/,
    )
  })
})
