import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { verifyTurnstile } from "./turnstile"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("required Turnstile", () => {
  it("rejects production without keys even with enforced device grants", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("TURNSTILE_SECRET_KEY", undefined)
    vi.stubEnv("FEEDBACK_GRANT_MODE", "enforce")
    expect(await verifyTurnstile("")).toBe(false)
    vi.stubEnv("FEEDBACK_GRANT_MODE", undefined)
    expect(await verifyTurnstile("")).toBe(false)
    for (const mode of ["off", "observe"]) {
      vi.stubEnv("FEEDBACK_GRANT_MODE", mode)
      expect(await verifyTurnstile("")).toBe(false)
    }
  })

  it("does not bypass a configured challenge", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("TURNSTILE_SECRET_KEY", "configured-secret")
    vi.stubEnv("FEEDBACK_GRANT_MODE", "enforce")
    expect(await verifyTurnstile("")).toBe(false)
  })

  it("accepts only the expected action and deployment hostname", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("TURNSTILE_SECRET_KEY", "configured-secret")
    vi.stubEnv("TURNSTILE_HOSTNAMES", "web-staging-920a.up.railway.app")
    const siteverify = vi.fn()
    vi.stubGlobal("fetch", siteverify)
    for (const [hostname, action, accepted] of [
      ["web-staging-920a.up.railway.app", "tv_feedback", true],
      ["localhost", "tv_feedback", false],
      ["web-staging-920a.up.railway.app", "login", false],
    ] as const) {
      siteverify.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, hostname, action }), {
          status: 200,
        }),
      )
      expect(await verifyTurnstile("valid-token")).toBe(accepted)
    }
    expect(siteverify).toHaveBeenCalledTimes(3)
  })
})
