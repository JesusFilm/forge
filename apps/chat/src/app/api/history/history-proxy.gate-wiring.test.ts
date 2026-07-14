// @vitest-environment node
// Join test (feat-241): the real POST wrappers' cookie -> identity -> gate
// (surface "history") wiring + the R6/AE5 real-cookie deny matrix the
// injectable-core suite cannot prove. Node env: jose throws under jsdom.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock the gate so we can assert the exact (identity, { surface }) it receives.
vi.mock("@/lib/seeker-gate", () => ({
  resolveSeekerGate: vi.fn(async () => ({
    seekerEnabled: false,
    outcome: "not_allowlisted",
  })),
}))

const REAL_SECRET = "s".repeat(40)

beforeEach(() => {
  // env.ts parses process.env at module load; stub then re-import fresh so the
  // signing secret is real on both the create and the POST-side read.
  vi.resetModules()
  vi.stubEnv("CHAT_SESSION_SECRET", REAL_SECRET)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function historyRequest(path: "list" | "thread", cookie?: string): Request {
  return new Request(`https://chat.example.com/api/history/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(
      path === "list" ? { page: 0 } : { conversationId: "conv-1" },
    ),
  })
}

describe("POST /api/history/* — session + gate wiring (feat-241)", () => {
  it("decodes the session cookie and gates it with the history surface, before any upstream call", async () => {
    const { createChatSessionCookie, CHAT_SESSION_COOKIE } =
      await import("@/auth/session-cookie")
    const { resolveSeekerGate } = await import("@/lib/seeker-gate")
    const { POST } = await import("./list/route")

    const cookieValue = await createChatSessionCookie({
      sub: "auth0|dogfooder-1",
      email: "person@example.com",
      emailVerified: true,
    })
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("upstream must not be called on a deny"))

    const response = await POST(
      historyRequest("list", `${CHAT_SESSION_COOKIE}=${cookieValue}`),
    )

    expect(resolveSeekerGate).toHaveBeenCalledTimes(1)
    expect(resolveSeekerGate).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: "auth0|dogfooder-1",
        email: "person@example.com",
        emailVerified: true,
      }),
      { surface: "history" },
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ reason: "gate_denied" })
  })

  it("wires the thread route through the same history-surface gate", async () => {
    const { createChatSessionCookie, CHAT_SESSION_COOKIE } =
      await import("@/auth/session-cookie")
    const { resolveSeekerGate } = await import("@/lib/seeker-gate")
    const { POST } = await import("./thread/route")

    const cookieValue = await createChatSessionCookie({
      sub: "auth0|dogfooder-1",
      email: "person@example.com",
      emailVerified: true,
    })
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("upstream must not be called on a deny"))

    const response = await POST(
      historyRequest("thread", `${CHAT_SESSION_COOKIE}=${cookieValue}`),
    )

    expect(resolveSeekerGate).toHaveBeenCalledWith(expect.anything(), {
      surface: "history",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(response.status).toBe(403)
  })
})

describe("POST /api/history/* — real-cookie deny matrix (AE3/AE5, R6/R8)", () => {
  it("refuses with 401 invalid_session when no cookie is present; the gate never runs", async () => {
    const { resolveSeekerGate } = await import("@/lib/seeker-gate")
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("upstream must not be called"))
    for (const path of ["list", "thread"] as const) {
      const { POST } = await import(`./${path}/route`)
      const response = await POST(historyRequest(path))
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ reason: "invalid_session" })
    }
    expect(resolveSeekerGate).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("refuses an EXPIRED real cookie with the same 401 shape (anonymous and expired are indistinguishable)", async () => {
    // Mint the cookie nine hours in the past (TTL is 8h), then verify at the
    // real current time — a genuinely expired signature, not a fake.
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() - 9 * 60 * 60 * 1000)
    const { createChatSessionCookie, CHAT_SESSION_COOKIE } =
      await import("@/auth/session-cookie")
    const cookieValue = await createChatSessionCookie({
      sub: "auth0|dogfooder-1",
      email: "person@example.com",
      emailVerified: true,
    })
    vi.useRealTimers()

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("upstream must not be called"))
    const { POST } = await import("./list/route")
    const response = await POST(
      historyRequest("list", `${CHAT_SESSION_COOKIE}=${cookieValue}`),
    )
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ reason: "invalid_session" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("refuses a TAMPERED cookie with the same 401 shape", async () => {
    const { createChatSessionCookie, CHAT_SESSION_COOKIE } =
      await import("@/auth/session-cookie")
    const cookieValue = await createChatSessionCookie({
      sub: "auth0|dogfooder-1",
      email: "person@example.com",
      emailVerified: true,
    })
    const tampered = `${cookieValue.slice(0, -2)}xx`

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("upstream must not be called"))
    const { POST } = await import("./thread/route")
    const response = await POST(
      historyRequest("thread", `${CHAT_SESSION_COOKIE}=${tampered}`),
    )
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ reason: "invalid_session" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
