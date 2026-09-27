import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ initialize: vi.fn() }))
vi.mock("@/auth/config", () => ({
  auth: {
    get $context() {
      return state.initialize()
    },
  },
}))

async function loadRoute() {
  vi.resetModules()
  return import("./route")
}

describe("auth health route", () => {
  beforeEach(() => {
    state.initialize.mockReset().mockResolvedValue({})
    vi.stubEnv("AUTH_BASE_URL", "https://auth.jesusfilm.org")
  })

  it("returns a healthy service payload after Auth initializes", async () => {
    const { GET } = await loadRoute()
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      service: "forge-auth",
      authBaseUrl: "https://auth.jesusfilm.org",
    })
  })

  it("returns 503 without exposing initialization errors", async () => {
    state.initialize.mockRejectedValue(
      new Error("private configuration detail"),
    )
    const { GET } = await loadRoute()
    const response = await GET()
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      ok: false,
      service: "forge-auth",
      authBaseUrl: "https://auth.jesusfilm.org",
    })
  })

  it("returns 503 when initialization stalls", async () => {
    state.initialize.mockReturnValue(new Promise(() => {}))
    const { GET } = await loadRoute()
    vi.useFakeTimers()
    try {
      const response = GET()
      await vi.advanceTimersByTimeAsync(5000)
      expect((await response).status).toBe(503)
    } finally {
      vi.useRealTimers()
    }
  })
})
