// @vitest-environment node
// Join test (feat-233): pins the real POST wrapper's cookie -> identity ->
// resolveSeekerGate(identity, { surface: "route" }) wiring. route.test.ts
// covers the injectable core (handleSeekerProxyRequest) with a hand-supplied
// gate; this proves the one-line closure in POST that compiles clean if the
// identity source or the surface literal is wrong.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock the gate so we can assert the exact (identity, { surface }) it receives.
// Deny (kill_switch) short-circuits before any upstream fetch.
vi.mock("@/lib/seeker-gate", () => ({
  resolveSeekerGate: vi.fn(async () => ({
    seekerEnabled: false,
    outcome: "kill_switch",
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
  vi.restoreAllMocks()
})

describe("POST /api/seeker — gate wiring (feat-233)", () => {
  it("decodes the session cookie and gates it with the route surface, before any upstream call", async () => {
    const { createChatSessionCookie, CHAT_SESSION_COOKIE } =
      await import("@/auth/session-cookie")
    const { resolveSeekerGate } = await import("@/lib/seeker-gate")
    const { POST } = await import("./route")

    const cookieValue = await createChatSessionCookie({
      sub: "auth0|dogfooder-1",
      email: "person@example.com",
      emailVerified: true,
    })

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("upstream must not be called on a deny"))

    const request = new Request("https://chat.example.com/api/seeker", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${CHAT_SESSION_COOKIE}=${cookieValue}`,
      },
      body: JSON.stringify({ text: "hello", conversationId: "conv-1" }),
    })

    const response = await POST(request)

    // The join: the gate saw the identity decoded from THIS cookie + surface "route".
    expect(resolveSeekerGate).toHaveBeenCalledTimes(1)
    expect(resolveSeekerGate).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: "auth0|dogfooder-1",
        email: "person@example.com",
        emailVerified: true,
      }),
      { surface: "route" },
    )

    // Deny short-circuits before the upstream fetch, emitting one gate_denied frame.
    expect(fetchSpy).not.toHaveBeenCalled()
    const body = await response.text()
    expect(body).toContain("gate_denied")
  })
})
