import { describe, expect, it, vi } from "vitest"

import { fixture } from "./portal-fixture.test-support.js"

describe("portal session recovery", () => {
  it("returns to the portal with a manual retry when OAuth state storage is unavailable", async () => {
    const f = fixture()
    f.deps.sessions.createState = async () => {
      throw new Error("database unavailable")
    }
    const response = await f.app.request("/login")
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "/portal?recovery=unavailable",
    )
    expect(response.headers.get("set-cookie")).toBeNull()
  })
  it("keeps concurrent tab OAuth states bound to the same browser cookie", async () => {
    const f = fixture()
    const first = await f.start()
    const secondLogin = await f.app.request("/login", {
      headers: { Cookie: first.browser },
    })
    const secondState = new URL(
      secondLogin.headers.get("location")!,
    ).searchParams.get("state")!
    expect(secondLogin.headers.get("set-cookie")).toContain(first.browser)
    expect((await f.callback(first.state, first.browser)).status).toBe(303)
    expect((await f.callback(secondState, first.browser)).status).toBe(303)
  })

  it("renews only admitted sessions from the portal origin", async () => {
    const f = fixture()
    const login = await f.start()
    const callback = await f.callback(login.state, login.browser)
    const session = callback.headers
      .get("set-cookie")!
      .match(/__Host-rag_portal=[^;]+/)![0]
    const post = (origin: string) =>
      f.app.request("/session/renew", {
        method: "POST",
        headers: { Cookie: session, Origin: origin },
      })
    expect((await post("https://evil.example")).status).toBe(403)
    const renewal = await post("https://rag.example")
    expect(renewal.status).toBe(200)
    expect(renewal.headers.get("set-cookie")).toContain("HttpOnly")
    expect(renewal.headers.get("cache-control")).toBe("no-store")
    expect(await renewal.json()).toEqual({
      expiresAt: expect.any(String),
      absoluteExpiresAt: expect.any(String),
    })
    f.setAllowed(false)
    expect((await post("https://rag.example")).status).toBe(403)
    expect(await (await post("https://rag.example")).json()).toEqual({
      error: "admission_denied",
    })
    f.setAllowed(true)
    f.sessions.delete(session.slice("__Host-rag_portal=".length))
    expect(await (await post("https://rag.example")).json()).toEqual({
      error: "session_expired",
    })
  })

  it("caps idle renewal at 24 hours and expires an untouched session after eight hours", async () => {
    vi.useFakeTimers()
    try {
      const start = new Date("2026-09-30T00:00:00.000Z")
      vi.setSystemTime(start)
      const f = fixture()
      const login = await f.start()
      const callback = await f.callback(login.state, login.browser)
      expect(callback.headers.get("set-cookie")).toContain("Max-Age=28800")
      const session = callback.headers
        .get("set-cookie")!
        .match(/__Host-rag_portal=[^;]+/)![0]
      const headers = { Cookie: session, Origin: "https://rag.example" }
      vi.setSystemTime(new Date("2026-09-30T07:00:00.000Z"))
      const first = await f.app.request("/session/renew", {
        method: "POST",
        headers,
      })
      expect((await first.json()).expiresAt).toBe("2026-09-30T15:00:00.000Z")
      vi.setSystemTime(new Date("2026-09-30T14:00:00.000Z"))
      const second = await f.app.request("/session/renew", {
        method: "POST",
        headers,
      })
      expect((await second.json()).expiresAt).toBe("2026-09-30T22:00:00.000Z")
      vi.setSystemTime(new Date("2026-09-30T21:00:00.000Z"))
      const capped = await f.app.request("/session/renew", {
        method: "POST",
        headers,
      })
      expect(await capped.json()).toEqual({
        expiresAt: "2026-10-01T00:00:00.000Z",
        absoluteExpiresAt: "2026-10-01T00:00:00.000Z",
      })
      vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"))
      expect((await f.app.request("/identity", { headers })).status).toBe(401)

      vi.setSystemTime(start)
      const untouched = await f.start()
      const untouchedCallback = await f.callback(
        untouched.state,
        untouched.browser,
      )
      const untouchedCookie = untouchedCallback.headers
        .get("set-cookie")!
        .match(/__Host-rag_portal=[^;]+/)![0]
      vi.setSystemTime(new Date("2026-09-30T08:00:00.000Z"))
      expect(
        (
          await f.app.request("/identity", {
            headers: { Cookie: untouchedCookie },
          })
        ).status,
      ).toBe(401)
    } finally {
      vi.useRealTimers()
    }
  })

  it("returns an OAuth outage to the readable portal fallback", async () => {
    const f = fixture()
    const login = await f.start()
    f.setAvailable(false)
    const callback = await f.callback(login.state, login.browser)
    expect(callback.status).toBe(303)
    expect(callback.headers.get("location")).toBe(
      "/portal?recovery=unavailable",
    )
    expect(callback.headers.get("cache-control")).toBe("no-store")
  })

  it.each(["consumeState", "revokeSession", "createSession"] as const)(
    "returns a session-store %s outage to the readable fallback",
    async (operation) => {
      const f = fixture()
      const login = await f.start()
      let cookie = login.browser
      if (operation === "revokeSession") {
        const first = await f.callback(login.state, login.browser)
        cookie += "; " + first.headers.get("set-cookie")!.split(";")[0]
      }
      const retry = operation === "revokeSession" ? await f.start() : login
      if (operation === "revokeSession")
        cookie = retry.browser + "; " + cookie.split("; ").slice(1).join("; ")
      vi.spyOn(f.deps.sessions, operation).mockRejectedValueOnce(
        new Error("session store unavailable"),
      )
      const response = await f.callback(retry.state, cookie)
      expect(response.status).toBe(303)
      expect(response.headers.get("location")).toBe(
        "/portal?recovery=unavailable",
      )
    },
  )
})
