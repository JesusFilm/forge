// @vitest-environment node
// This probe must fail ONLY when the process cannot serve HTTP. The case that
// matters is the default-off boot: a probe that read config would fail every
// deploy of the posture chat actually ships in.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The Seeker + auth vars from src/config/env.ts. NODE_ENV is deliberately not
// cleared — vitest owns it, and the route reads no env either way.
const CHAT_ENV_KEYS = [
  "SEEKER_CHAT_ENABLED",
  "SEEKER_MASTRA_BASE_URL",
  "SEEKER_MASTRA_ALLOWED_HOSTS",
  "AI_CHAT_MASTRA_API_KEY",
  "SEEKER_TIMEOUT_MS",
  "SEEKER_ALLOWED_EMAILS",
  "AUTH_ISSUER_URL",
  "AUTH_CHAT_CLIENT_ID",
  "AUTH_CHAT_CLIENT_SECRET",
  "CHAT_BASE_URL",
  "CHAT_SESSION_SECRET",
  "AUTH_COOKIE_PREFIX",
] as const

const HEALTHY_BODY = { ok: true, service: "forge-chat" }

// vitest runs from the package root (apps/chat).
const ROUTE_PATH = "src/app/api/health/route.ts"

const saved = new Map<string, string | undefined>()

beforeEach(() => {
  for (const key of CHAT_ENV_KEYS) saved.set(key, process.env[key])
})

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  saved.clear()
  vi.resetModules()
})

async function importRouteWith(
  env: Partial<Record<(typeof CHAT_ENV_KEYS)[number], string>>,
) {
  for (const key of CHAT_ENV_KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(env)) process.env[key] = value
  vi.resetModules()
  return await import("./route")
}

describe("GET /api/health", () => {
  it("answers 200 with the fixed ok/service body", async () => {
    const { GET } = await importRouteWith({})
    const response = GET()
    expect(response.status).toBe(200)
    // Exact shape, not a subset: an added field is how a secret would arrive on
    // this unauthenticated, publicly reachable endpoint.
    await expect(response.json()).resolves.toEqual(HEALTHY_BODY)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(response.headers.get("set-cookie")).toBeNull()
  })

  it("still answers 200 with NO Seeker env configured at all", async () => {
    const { GET } = await importRouteWith({})
    for (const key of CHAT_ENV_KEYS) expect(process.env[key]).toBeUndefined()
    const response = GET()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(HEALTHY_BODY)
  })

  // Anti-vacuous companion: the case above passes for a route hard-wired to
  // "unconfigured is healthy" too. Only an env-INVARIANT route answers
  // identically under a fully configured environment as under an empty one.
  it("answers identically with Seeker fully configured", async () => {
    const { GET } = await importRouteWith({
      SEEKER_CHAT_ENABLED: "true",
      SEEKER_MASTRA_BASE_URL: "https://mastra.railway.internal",
      SEEKER_MASTRA_ALLOWED_HOSTS: "mastra.railway.internal",
      AI_CHAT_MASTRA_API_KEY: "test-lane-bearer",
      SEEKER_ALLOWED_EMAILS: "dogfood@example.com",
    })
    const response = GET()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(HEALTHY_BODY)
  })

  it("is force-dynamic so the probe is never served from a static cache", async () => {
    const route = await importRouteWith({})
    expect(route.dynamic).toBe("force-dynamic")
  })

  // The route is deliberately unauthenticated. A later `export async function
  // POST` would inherit that — no session decode, no gate, no rate limit — so
  // the method surface is pinned rather than left to convention.
  it("exports GET and nothing else callable", async () => {
    const route = await importRouteWith({})
    expect(Object.keys(route).sort()).toEqual(["GET", "dynamic"])
  })
})

// Shallowness made structural. Any import here is the first step toward a
// Mastra/Postgres outage becoming a chat rollback, so the module is pinned to
// zero dependencies rather than to "no known bad import".
const FORBIDDEN_IMPORT_FORMS = [
  // Covers `import x from "y"`, the no-space `import{x}from"y"`, and
  // `export * from "y"` — all of which the old `^\s*import\s` missed.
  { name: "static import / re-export", pattern: /\bfrom\s*["']/ },
  { name: "commonjs require", pattern: /\brequire\s*\(/ },
  // No `await` prefix: `void import(...)` and `import(...).then()` also count.
  { name: "dynamic import", pattern: /\bimport\s*\(/ },
] as const

describe("healthcheck depth", () => {
  it("imports nothing — no config, no transport, no session", () => {
    const source = readFileSync(join(process.cwd(), ROUTE_PATH), "utf8")
    for (const { name, pattern } of FORBIDDEN_IMPORT_FORMS) {
      expect(source, `unexpected ${name}`).not.toMatch(pattern)
    }
  })

  // The guard above is only worth its line count if it can go red. Each
  // pattern is falsified here against the source shape it exists to catch.
  it.each([
    ['import { env } from "@/config/env"', "static import / re-export"],
    ['import{env}from"@/config/env"', "static import / re-export"],
    ['export * from "@/config/env"', "static import / re-export"],
    ['const { env } = require("@/config/env")', "commonjs require"],
    ['void import("@/config/env")', "dynamic import"],
    ['import("@/config/env").then(() => {})', "dynamic import"],
  ])("rejects %j", (badSource) => {
    expect(
      FORBIDDEN_IMPORT_FORMS.some(({ pattern }) => pattern.test(badSource)),
    ).toBe(true)
  })
})

describe("railway.toml wiring", () => {
  // The route answering correctly proves nothing if Railway probes a different
  // path. Deleting healthcheckPath or renaming the directory must go red here,
  // not silently disarm the deploy gate feat-306 will depend on.
  it("probes a path this app actually serves", () => {
    const toml = readFileSync(join(process.cwd(), "railway.toml"), "utf8")
    const probedPath = toml.match(/^healthcheckPath\s*=\s*"([^"]+)"/m)?.[1]
    expect(probedPath).toBe("/api/health")
    const routeFile = join("src/app", probedPath ?? "", "route.ts")
    expect(routeFile).toBe(ROUTE_PATH)
    expect(existsSync(join(process.cwd(), routeFile))).toBe(true)
  })
})
