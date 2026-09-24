import { describe, expect, it } from "vitest"

import { createApp } from "./app.js"
import { parseTokenRegistry } from "./auth.js"
import { createPortal } from "./portal.js"
import { admitted, parsePortalAllowlist } from "./portal-policy.js"
import type { AdmissionProvider } from "./portal-github.js"
import type { SessionStore } from "../../contracts/portal-sessions.js"

function fixture() {
  const states = new Map<string, string>()
  const sessions = new Map<string, { id: number; login: string }>()
  let allowed = true
  let eligible = true
  let available = true
  let reassigned = false
  const store: SessionStore = {
    async createState(state, browser) {
      states.set(state, browser)
    },
    async consumeState(state, browser) {
      if (states.get(state) !== browser) return false
      states.delete(state)
      return true
    },
    async createSession(token, identity) {
      sessions.set(token, identity)
    },
    async getSession(token) {
      return sessions.get(token) ?? null
    },
    async revokeSession(token) {
      sessions.delete(token)
    },
    async close() {},
  }
  const admission: AdmissionProvider = {
    async current() {
      if (!available) throw new Error("publication_unavailable")
      return {
        sha: allowed ? "merged" : "removed",
        allowlist: { users: allowed ? [{ login: "engineer", id: 42 }] : [] },
      }
    },
    async eligible() {
      return eligible
    },
    async exchange(code) {
      if (code !== "valid") throw new Error("invalid_code")
      return { login: "engineer", id: reassigned ? 43 : 42 }
    },
  }
  const deps = {
    sessions: store,
    admission,
    clientId: "client",
    callbackUrl: "https://rag.example/portal/callback",
    origin: "https://rag.example",
  }
  const app = createPortal(deps)
  async function start() {
    const response = await app.request("/login")
    const state = new URL(response.headers.get("location")!).searchParams.get(
      "state",
    )!
    const browser = response.headers.get("set-cookie")!.split(";")[0]
    return { state, browser }
  }
  async function callback(state: string, browser: string, code = "valid") {
    return app.request(`/callback?state=${state}&code=${code}`, {
      headers: { Cookie: browser },
    })
  }
  return {
    app,
    deps,
    start,
    callback,
    sessions,
    setAllowed(value: boolean) {
      allowed = value
    },
    setEligible(value: boolean) {
      eligible = value
    },
    setAvailable(value: boolean) {
      available = value
    },
    setReassigned(value: boolean) {
      reassigned = value
    },
  }
}

describe("portal admission", () => {
  it("pins normalized login and numeric identity", () => {
    const list = parsePortalAllowlist({
      users: [{ login: "Engineer", id: 42 }],
    })
    expect(admitted(list, "engineer", 42)).toBe(true)
    expect(admitted(list, "engineer", 43)).toBe(false)
    expect(() =>
      parsePortalAllowlist({
        users: [
          { login: "A", id: 1 },
          { login: "a", id: 2 },
        ],
      }),
    ).toThrow("duplicate_login")
    expect(() =>
      parsePortalAllowlist({ users: [{ login: "bad--name", id: 9 }] }),
    ).toThrow("invalid_user")
  })

  it("admits a listed identity and denies an unmerged addition and removal on the next action", async () => {
    const f = fixture()
    const first = await f.start()
    f.setAllowed(false)
    expect((await f.callback(first.state, first.browser)).status).toBe(403)
    f.setAllowed(true)
    const second = await f.start()
    const callback = await f.callback(second.state, second.browser)
    expect(callback.status).toBe(303)
    const session = callback.headers
      .get("set-cookie")!
      .match(/__Host-rag_portal=[^;]+/)![0]
    expect(
      (await f.app.request("/", { headers: { Cookie: session } })).status,
    ).toBe(200)
    f.setAllowed(false)
    expect(
      (await f.app.request("/", { headers: { Cookie: session } })).status,
    ).toBe(401)
  })

  it("rejects state mismatch, replay, tampering and fixed session cookies", async () => {
    const f = fixture()
    const login = await f.start()
    expect((await f.callback("different", login.browser)).status).toBe(401)
    expect(
      (await f.callback(login.state, "__Host-rag_oauth=other")).status,
    ).toBe(401)
    expect(
      (await f.callback(login.state, login.browser, "tampered")).status,
    ).toBe(401)
    expect((await f.callback(login.state, login.browser)).status).toBe(401)
    const next = await f.start()
    f.sessions.set("fixed", { login: "engineer", id: 42 })
    const fixed = await f.app.request(
      `/callback?state=${next.state}&code=valid`,
      { headers: { Cookie: `${next.browser}; __Host-rag_portal=fixed` } },
    )
    expect(fixed.status).toBe(303)
    expect(f.sessions.has("fixed")).toBe(false)
    expect(fixed.headers.get("set-cookie")).not.toContain(
      "__Host-rag_portal=fixed",
    )
  })

  it("rechecks current permission and enforces origin on sign out", async () => {
    const f = fixture()
    const login = await f.start()
    const response = await f.callback(login.state, login.browser)
    const session = response.headers
      .get("set-cookie")!
      .match(/__Host-rag_portal=[^;]+/)![0]
    expect(
      (
        await f.app.request("/sign-out", {
          method: "POST",
          headers: { Cookie: session, Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403)
    f.setEligible(false)
    expect(
      (await f.app.request("/", { headers: { Cookie: session } })).status,
    ).toBe(401)
    f.setEligible(true)
    expect(
      (
        await f.app.request("/sign-out", {
          method: "POST",
          headers: { Cookie: session, Origin: "https://rag.example" },
        })
      ).status,
    ).toBe(200)
    expect(
      (await f.app.request("/", { headers: { Cookie: session } })).status,
    ).toBe(401)
  })

  it("fails closed on unavailable publication and reassigned handles, without management routes", async () => {
    const f = fixture()
    const first = await f.start()
    f.setReassigned(true)
    expect((await f.callback(first.state, first.browser)).status).toBe(403)
    f.setReassigned(false)
    const next = await f.start()
    const response = await f.callback(next.state, next.browser)
    const session = response.headers
      .get("set-cookie")!
      .match(/__Host-rag_portal=[^;]+/)![0]
    expect(response.headers.get("set-cookie")).toContain("HttpOnly")
    expect(response.headers.get("set-cookie")).toContain("Secure")
    f.setAvailable(false)
    expect(
      (await f.app.request("/", { headers: { Cookie: session } })).status,
    ).toBe(503)
    f.setAvailable(true)
    expect(
      (await f.app.request("/consumers", { headers: { Cookie: session } }))
        .status,
    ).toBe(404)
    expect(
      (await f.app.request("/usage", { headers: { Cookie: session } })).status,
    ).toBe(404)
  })

  it("mounts the portal separately from bearer-protected retrieval", async () => {
    const f = fixture()
    const app = createApp({
      retriever: { search: async () => [] },
      tokens: parseTokenRegistry(JSON.stringify({ token: ["*"] })),
      portal: f.deps,
    })
    expect((await app.request("/portal")).status).toBe(401)
    expect((await app.request("/portal/login")).status).toBe(302)
    expect((await app.request("/v1/health")).status).toBe(200)
    expect((await app.request("/v1/search", { method: "POST" })).status).toBe(
      401,
    )
  })
})
