import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createContext } from "@/graphql/context"

// The spike-role header is the only auth path in Unit 6 and it exists
// explicitly to ease local dev / spike testing. These tests assert the
// guardrails around that header:
//
// 1. It resolves a principal for editorial tiers in non-production.
// 2. It is IGNORED entirely when NODE_ENV === 'production' — a deployed
//    environment must never grant ADMIN via a header.
// 3. SYSTEM is not accepted via the header even in dev. Workflow trust
//    comes from an in-process path (Unit 11), not a user-supplied header.

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/graphql", { headers })
}

describe("createContext — x-spike-role header", () => {
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    vi.unstubAllEnvs()
  })

  describe("non-production", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development"
    })

    it("resolves ADMIN principal", async () => {
      const ctx = await createContext({
        request: req({ "x-spike-role": "ADMIN" }),
      })
      expect(ctx.user).toEqual({ id: "spike-admin", role: "ADMIN" })
    })

    it("resolves EDITOR principal", async () => {
      const ctx = await createContext({
        request: req({ "x-spike-role": "EDITOR" }),
      })
      expect(ctx.user).toEqual({ id: "spike-editor", role: "EDITOR" })
    })

    it("resolves VIEWER principal", async () => {
      const ctx = await createContext({
        request: req({ "x-spike-role": "VIEWER" }),
      })
      expect(ctx.user).toEqual({ id: "spike-viewer", role: "VIEWER" })
    })

    it("SYSTEM is NOT accepted — header cannot mint a workflow principal", async () => {
      const ctx = await createContext({
        request: req({ "x-spike-role": "SYSTEM" }),
      })
      expect(ctx.user).toBeNull()
    })

    it("unknown role falls back to PUBLIC", async () => {
      const ctx = await createContext({
        request: req({ "x-spike-role": "SUPERADMIN" }),
      })
      expect(ctx.user).toBeNull()
    })

    it("missing header → PUBLIC", async () => {
      const ctx = await createContext({ request: req() })
      expect(ctx.user).toBeNull()
    })
  })

  describe("production", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "production"
    })

    it("ignores x-spike-role=ADMIN in production", async () => {
      const ctx = await createContext({
        request: req({ "x-spike-role": "ADMIN" }),
      })
      expect(ctx.user).toBeNull()
    })

    it("ignores x-spike-role=EDITOR in production", async () => {
      const ctx = await createContext({
        request: req({ "x-spike-role": "EDITOR" }),
      })
      expect(ctx.user).toBeNull()
    })
  })

  it("always wires loaders and prisma", async () => {
    const ctx = await createContext({ request: req() })
    expect(ctx.prisma).toBeDefined()
    expect(ctx.loaders).toBeDefined()
    expect(ctx.loaders.experienceById).toBeDefined()
  })
})
