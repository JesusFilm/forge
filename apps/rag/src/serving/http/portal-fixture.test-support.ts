import { createPortal } from "./portal.js"
import type { AdmissionProvider } from "./portal-github.js"
import type { SessionStore } from "../../contracts/portal-sessions.js"

export function fixture() {
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
