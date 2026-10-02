// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest"
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
it("rechecks both real gates from the signed cookie, ignoring request-supplied identity", async () => {
  vi.resetModules()
  vi.stubEnv("CHAT_SESSION_SECRET", "s".repeat(40))
  vi.stubEnv("SEEKER_CHAT_ENABLED", "true")
  vi.stubEnv("SEEKER_ALLOWED_EMAILS", "agent@local")
  vi.stubEnv("APOLOGIST_COMPARE_ENABLED", "true")
  vi.stubEnv("APOLOGIST_ALLOWED_EMAILS", "agent@local")
  vi.stubEnv("APOLOGIST_API_URL", "")
  const { POST } = await import("./route")
  const { createChatSessionCookie, CHAT_SESSION_COOKIE } =
    await import("@/auth/session-cookie")
  const cookie = await createChatSessionCookie({
    sub: "tester",
    email: "agent@local",
    emailVerified: true,
  })
  const fetcher = vi.spyOn(globalThis, "fetch")
  const request = (signed: boolean) =>
    new Request("http://localhost/api/apologist", {
      method: "POST",
      headers: signed ? { cookie: `${CHAT_SESSION_COOKIE}=${cookie}` } : {},
      body: JSON.stringify({
        identity: { email: "agent@local" },
        messages: [{ role: "user", content: "Q" }],
      }),
    })
  expect((await POST(request(false))).status).toBe(403)
  expect((await POST(request(true))).status).toBe(503)
  vi.stubEnv("APOLOGIST_COMPARE_ENABLED", "false")
  expect((await POST(request(true))).status).toBe(403)
  vi.stubEnv("APOLOGIST_COMPARE_ENABLED", "true")
  vi.stubEnv("APOLOGIST_ALLOWED_EMAILS", "elsewhere@local")
  expect((await POST(request(true))).status).toBe(403)
  expect(fetcher).not.toHaveBeenCalled()
})
