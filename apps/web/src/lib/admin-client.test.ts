import { afterEach, describe, expect, it, vi } from "vitest"

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    ADMIN_GRAPHQL_URL: "https://admin.local/api/graphql",
    WEB_ADMIN_API_KEYS: undefined as string | undefined,
  },
}))

vi.mock("@/env", () => ({
  env: mockEnv,
}))

describe("adminClient", () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    mockEnv.WEB_ADMIN_API_KEYS = undefined
  })

  it("constructs once and is reused across imports (singleton)", async () => {
    const { default: clientA } = await import("./admin-client")
    const { default: clientB } = await import("./admin-client")
    expect(clientA).toBe(clientB)
  })

  it("uses a fresh AbortSignal.timeout per fetch call (NOT module-scope) so the second call's timeout still works", async () => {
    // Foot-gun guard: if AbortSignal.timeout(3000) is captured at module
    // scope instead of inside the fetch override, all calls share one
    // signal that fires 3 s after process boot. The first call may still
    // succeed (signal hasn't fired yet); the second call then lands on an
    // already-aborted signal and throws synchronously regardless of the
    // server's actual response time. We validate the shape — every call
    // gets its own AbortSignal — by capturing the signal handed to fetch
    // on each invocation and asserting they are distinct instances.
    const capturedSignals: AbortSignal[] = []
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_input, init) => {
        if (init?.signal) capturedSignals.push(init.signal)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: { experienceBySlug: null },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        )
      })

    const { default: client } = await import("./admin-client")
    const { adminExperienceBySlugOperation } =
      await import("./fragments/admin-experience")

    await client.query({
      query: adminExperienceBySlugOperation,
      variables: { locale: "en", slug: "x" },
    })
    await client.query({
      query: adminExperienceBySlugOperation,
      variables: { locale: "en", slug: "y" },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(capturedSignals.length).toBe(2)
    // Distinct AbortSignal instances per call. Module-scope capture would
    // yield referentially identical signals across both calls.
    expect(capturedSignals[0]).not.toBe(capturedSignals[1])
    // Both signals are still un-aborted at observation time (they only
    // abort if the request exceeds 3 s).
    expect(capturedSignals[0]?.aborted).toBe(false)
    expect(capturedSignals[1]?.aborted).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // U6 (plan-003 PR-B) — bearer header injection from WEB_ADMIN_API_KEYS
  // ---------------------------------------------------------------------------

  it("attaches Authorization: Bearer ${first_key} when WEB_ADMIN_API_KEYS is set", async () => {
    mockEnv.WEB_ADMIN_API_KEYS = "primary-key,secondary-key"
    const capturedHeaders: Headers[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      capturedHeaders.push(new Headers(init?.headers))
      return Promise.resolve(
        new Response(JSON.stringify({ data: { experienceBySlug: null } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    })

    // Module-scope bearer read — re-import after mutating env.
    vi.resetModules()
    const { default: client } = await import("./admin-client")
    const { adminExperienceBySlugOperation } =
      await import("./fragments/admin-experience")

    await client.query({
      query: adminExperienceBySlugOperation,
      variables: { locale: "en", slug: "x" },
    })

    expect(capturedHeaders.length).toBe(1)
    expect(capturedHeaders[0].get("Authorization")).toBe("Bearer primary-key")
  })

  it("omits Authorization header when WEB_ADMIN_API_KEYS is unset (anonymous PUBLIC scope)", async () => {
    mockEnv.WEB_ADMIN_API_KEYS = undefined
    const capturedHeaders: Headers[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      capturedHeaders.push(new Headers(init?.headers))
      return Promise.resolve(
        new Response(JSON.stringify({ data: { experienceBySlug: null } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    })

    vi.resetModules()
    const { default: client } = await import("./admin-client")
    const { adminExperienceBySlugOperation } =
      await import("./fragments/admin-experience")

    await client.query({
      query: adminExperienceBySlugOperation,
      variables: { locale: "en", slug: "x" },
    })

    expect(capturedHeaders.length).toBe(1)
    expect(capturedHeaders[0].has("Authorization")).toBe(false)
  })

  it("trims surrounding whitespace from the first CSV entry", async () => {
    mockEnv.WEB_ADMIN_API_KEYS = "  trimmed-key  , other-key"
    const capturedHeaders: Headers[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      capturedHeaders.push(new Headers(init?.headers))
      return Promise.resolve(
        new Response(JSON.stringify({ data: { experienceBySlug: null } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    })

    vi.resetModules()
    const { default: client } = await import("./admin-client")
    const { adminExperienceBySlugOperation } =
      await import("./fragments/admin-experience")

    await client.query({
      query: adminExperienceBySlugOperation,
      variables: { locale: "en", slug: "x" },
    })

    expect(capturedHeaders[0].get("Authorization")).toBe("Bearer trimmed-key")
  })

  // Defense-in-depth: a hostile (or misconfigured) admin server echoes
  // the inbound Authorization header in its 500 response body. The
  // admin-client itself never logs the bearer; this test guards against
  // future edits accidentally introducing console output that includes
  // the request headers. If a future change adds a `console.error(err)`
  // that serializes the Apollo error's networkError.response (which can
  // include the request body), the bearer must NOT appear in the
  // captured console output.
  //
  // Mutation-test discipline: removing the explicit Headers construction
  // in `timeoutFetch` (so the bearer flows back via the default
  // serializer) would not directly break this test — the test passes
  // because the admin-client itself never writes to console. The test's
  // job is to lock the invariant that no current code path leaks; future
  // code that introduces an Apollo error logger MUST add scrubbing or
  // this test will catch it.
  it("bearer key never appears in any console.{log,error,warn} payload when admin returns 500", async () => {
    const BEARER = "very-secret-key-do-not-leak-9f8e7d6c"
    mockEnv.WEB_ADMIN_API_KEYS = BEARER

    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      // Hostile-server scenario: echo the Authorization header value back
      // in the response body. A naive Apollo error log path that
      // stringifies networkError.response would surface this.
      const auth = new Headers(init?.headers).get("Authorization") ?? ""
      return Promise.resolve(
        new Response(
          JSON.stringify({
            echoedAuth: auth,
            errors: [{ message: "boom" }],
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        ),
      )
    })

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined)

    try {
      vi.resetModules()
      const { default: client } = await import("./admin-client")
      const { adminExperienceBySlugOperation } =
        await import("./fragments/admin-experience")

      // Don't care whether Apollo rejects or resolves-with-error — only
      // that the bearer doesn't leak into any console payload.
      const result = await client
        .query({
          query: adminExperienceBySlugOperation,
          variables: { locale: "en", slug: "x" },
        })
        .catch((err) => ({ error: err }))
      void result

      const allLogs = [
        ...logSpy.mock.calls,
        ...errSpy.mock.calls,
        ...warnSpy.mock.calls,
      ]
        .flat()
        .map((arg) => {
          if (typeof arg === "string") return arg
          try {
            return JSON.stringify(arg)
          } catch {
            return String(arg)
          }
        })
        .join("\n")

      expect(allLogs).not.toContain(BEARER)
    } finally {
      logSpy.mockRestore()
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})
