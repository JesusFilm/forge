import { afterEach, describe, expect, it, vi } from "vitest"

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { ADMIN_GRAPHQL_URL: "https://admin.local/api/graphql" },
}))

vi.mock("@/env", () => ({
  env: mockEnv,
}))

describe("adminClient", () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
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
})
