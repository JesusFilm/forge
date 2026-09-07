import { createAuthEndpoint, dispatchAuthEndpoint } from "better-auth/api"
import { createCookieGetter } from "better-auth/cookies"
import { describe, expect, it, vi } from "vitest"

import { selfRpStateCookiePlugin } from "./self-rp-state-cookie-plugin"

// The hook is a real better-call middleware, so `setSignedCookie` and the
// returned headers are the vendor's. Only the auth context is faked: base
// URL, secret, the cookie factory, and the endpoint's response.
const BASE_URL = "https://auth.jesusfilm.org/api/auth"
const SELF_RP_CALLBACK = `${BASE_URL}/callback/jfp`

type AfterHook = {
  matcher: (context: { path?: string }) => boolean
  handler: (context: unknown) => Promise<{ headers?: Headers } | undefined>
}

function hook(): AfterHook {
  const hooks = selfRpStateCookiePlugin().hooks?.after as unknown as AfterHook[]
  expect(hooks).toHaveLength(1)
  return hooks[0]!
}

async function run(
  path: string,
  response: { location?: string; returned?: unknown },
  baseURL = BASE_URL,
): Promise<Headers | undefined> {
  const responseHeaders = new Headers()
  if (response.location) responseHeaders.set("location", response.location)
  const result = await hook().handler({
    path,
    headers: new Headers(),
    returnHeaders: true,
    context: {
      baseURL,
      secret: "test-secret-with-at-least-thirty-two-chars",
      responseHeaders,
      returned: response.returned,
      createAuthCookie: (name: string, options?: { maxAge?: number }) => ({
        name: `better-auth.${name}`,
        attributes: { path: "/", httpOnly: true, sameSite: "lax", ...options },
      }),
    },
  } as never)
  return result?.headers
}

describe("selfRpStateCookiePlugin", () => {
  it("runs only on the provider endpoints that can hand out a code", () => {
    const { matcher } = hook()
    expect(matcher({ path: "/oauth2/authorize" })).toBe(true)
    expect(matcher({ path: "/oauth2/consent" })).toBe(true)
    expect(matcher({ path: "/oauth2/continue" })).toBe(true)
    expect(matcher({ path: "/callback/jfp" })).toBe(false)
    expect(matcher({ path: "/sign-in/social" })).toBe(false)
    expect(matcher({})).toBe(false)
  })

  // The nested provider flow (Google/Okta inside the hosted page) overwrites
  // and then expires the ONE `state` cookie the self-RP callback checks.
  it("plants the self-RP state cookie on the redirect that carries the code", async () => {
    const headers = await run("/oauth2/authorize", {
      location: `${SELF_RP_CALLBACK}?code=abc&state=state-123&iss=${encodeURIComponent(
        "https://auth.jesusfilm.org",
      )}`,
    })
    expect(headers?.get("set-cookie")).toMatch(/better-auth\.state=state-123\./)
    expect(headers?.get("set-cookie")).toMatch(/Max-Age=300/)
  })

  it("plants it on the JSON shape a fetch caller receives", async () => {
    const headers = await run("/oauth2/authorize", {
      returned: {
        redirect: true,
        url: `${SELF_RP_CALLBACK}?code=abc&state=state-456`,
      },
    })
    expect(headers?.get("set-cookie")).toMatch(/better-auth\.state=state-456\./)
  })

  // An error redirect still runs the callback's state parse, which needs the
  // cookie to route the error back to the app scheme instead of a web page.
  it("plants it on an error redirect to the self-RP callback too", async () => {
    const headers = await run("/oauth2/authorize", {
      location: `${SELF_RP_CALLBACK}?error=access_denied&state=state-789`,
    })
    expect(headers?.get("set-cookie")).toMatch(/better-auth\.state=state-789\./)
  })

  it("leaves every other redirect target alone", async () => {
    for (const location of [
      // Another provider's callback on this origin.
      `${BASE_URL}/callback/google?code=abc&state=state-123`,
      // A third-party client's redirect URI.
      "https://admin.jesusfilm.org/api/auth/callback/jfp?code=abc&state=state-123",
      // The self-RP callback on a different origin.
      "https://evil.example/api/auth/callback/jfp?code=abc&state=state-123",
      // The hosted login page, where the provider sends a signed-out browser.
      "https://auth.jesusfilm.org/login?client_id=jfp_mobile_production&state=state-123",
      // The callback path outside the configured base path.
      "https://auth.jesusfilm.org/callback/jfp?code=abc&state=state-123",
    ]) {
      const headers = await run("/oauth2/authorize", { location })
      expect(headers?.get("set-cookie"), location).toBeNull()
    }
  })

  it("ignores a self-RP redirect that carries no state", async () => {
    const headers = await run("/oauth2/authorize", {
      location: `${SELF_RP_CALLBACK}?code=abc`,
    })
    expect(headers?.get("set-cookie")).toBeNull()
  })

  it("ignores a response with neither a location nor a redirect payload", async () => {
    expect((await run("/oauth2/authorize", {}))?.get("set-cookie")).toBeNull()
    expect(
      (await run("/oauth2/authorize", { returned: { redirect: false } }))?.get(
        "set-cookie",
      ),
    ).toBeNull()
    expect(
      (await run("/oauth2/authorize", { location: "not a url" }))?.get(
        "set-cookie",
      ),
    ).toBeNull()
  })

  it("matches the callback path against the configured base path", async () => {
    const localBase = "http://localhost:3004/api/auth"
    const planted = await run(
      "/oauth2/authorize",
      { location: `${localBase}/callback/jfp?code=abc&state=s-1` },
      localBase,
    )
    expect(planted?.get("set-cookie")).toMatch(/better-auth\.state=s-1\./)

    const wrongBase = await run(
      "/oauth2/authorize",
      { location: `http://localhost:3004/callback/jfp?code=abc&state=s-1` },
      localBase,
    )
    expect(wrongBase?.get("set-cookie")).toBeNull()
  })
})

// The unit cases above fake the auth context. These run a redirecting
// endpoint through Better Auth's own hook runner with the real cookie factory,
// so the cookie NAME and the header merge are the vendor's, not the test's.
describe("selfRpStateCookiePlugin through Better Auth's dispatch pipeline", () => {
  const SECRET = "test-secret-with-at-least-thirty-two-chars"

  function authContext() {
    const options = {
      baseURL: "https://auth.jesusfilm.org",
      basePath: "/api/auth",
      secret: SECRET,
      plugins: [selfRpStateCookiePlugin()],
    }
    return {
      options,
      baseURL: BASE_URL,
      secret: SECRET,
      createAuthCookie: createCookieGetter(options),
      logger: {
        level: "error",
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      },
      session: null,
    }
  }

  async function dispatch(
    handler: (ctx: { redirect: (url: string) => Error }) => Promise<unknown>,
  ): Promise<Response> {
    const endpoint = createAuthEndpoint(
      "/oauth2/authorize",
      { method: "GET" },
      handler as never,
    )
    return (await dispatchAuthEndpoint(endpoint, {
      context: authContext(),
      asResponse: true,
      method: "GET",
      headers: new Headers(),
    } as never)) as Response
  }

  it("appends the production-named state cookie to the 302 that carries the code", async () => {
    const target = `${SELF_RP_CALLBACK}?code=abc&state=state-123`
    const response = await dispatch(async (ctx) => {
      throw ctx.redirect(target)
    })

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(target)
    // parseState reads the same getter, so the `__Secure-` prefix must match.
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) =>
          cookie.startsWith("__Secure-better-auth.state=state-123."),
        ),
    ).toBe(true)
  })

  it("appends it to the JSON redirect a fetch caller receives", async () => {
    const target = `${SELF_RP_CALLBACK}?code=abc&state=state-456`
    const response = await dispatch(async () => ({
      redirect: true,
      url: target,
    }))

    expect(response.status).toBe(200)
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) =>
          cookie.startsWith("__Secure-better-auth.state=state-456."),
        ),
    ).toBe(true)
  })

  it("leaves the login-page redirect for a signed-out browser alone", async () => {
    const response = await dispatch(async (ctx) => {
      throw ctx.redirect(
        "https://auth.jesusfilm.org/login?client_id=jfp_mobile_production&state=state-123",
      )
    })

    expect(response.status).toBe(302)
    expect(response.headers.getSetCookie()).toEqual([])
  })
})
