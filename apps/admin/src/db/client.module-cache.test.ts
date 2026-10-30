import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { adapters, clients } = vi.hoisted(() => {
  const adapters: unknown[] = []
  const clients: unknown[] = []
  return { adapters, clients }
})

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(config: unknown) {
      adapters.push(config)
    }
  },
}))
vi.mock("@prisma/client", () => ({
  Prisma: { defineExtension: vi.fn() },
  PrismaClient: class {
    constructor() {
      clients.push(this)
    }
    $extends() {
      return this
    }
  },
}))

const cache = globalThis as typeof globalThis & {
  prisma?: unknown
  syncPrisma?: unknown
  studioRenderPrisma?: unknown
}
const original = {
  prisma: cache.prisma,
  syncPrisma: cache.syncPrisma,
  studioRenderPrisma: cache.studioRenderPrisma,
}

beforeEach(() => {
  vi.resetModules()
  adapters.length = 0
  clients.length = 0
  delete cache.prisma
  delete cache.syncPrisma
  delete cache.studioRenderPrisma
  vi.stubEnv("DATABASE_URL", "postgresql://localhost:1/module_cache_test")
})

afterEach(() => {
  vi.unstubAllEnvs()
  if (original.prisma === undefined) delete cache.prisma
  else cache.prisma = original.prisma
  if (original.syncPrisma === undefined) delete cache.syncPrisma
  else cache.syncPrisma = original.syncPrisma
  if (original.studioRenderPrisma === undefined) delete cache.studioRenderPrisma
  else cache.studioRenderPrisma = original.studioRenderPrisma
})

describe.each(["production", "development"])(
  "%s client module reuse",
  (mode) => {
    it("shares each pool across module evaluations while keeping sync isolated", async () => {
      vi.stubEnv("NODE_ENV", mode)
      const first = await import("./client")
      // Model separate Next server module caches in the same process. The real
      // production-build editor/GraphQL probe verifies that deployed boundary.
      vi.resetModules()
      const second = await import("./client")

      expect(second.prisma).toBe(first.prisma)
      expect(second.syncPrisma).toBe(first.syncPrisma)
      expect(second.studioRenderPrisma).toBe(first.studioRenderPrisma)
      expect(first.prisma).not.toBe(first.syncPrisma)
      expect(first.studioRenderPrisma).not.toBe(first.prisma)
      expect(first.studioRenderPrisma).not.toBe(first.syncPrisma)
      expect(clients).toHaveLength(3)
      expect(adapters).toEqual([
        expect.objectContaining({ max: 10, connectionTimeoutMillis: 20_000 }),
        expect.objectContaining({ max: 5, connectionTimeoutMillis: 60_000 }),
        expect.objectContaining({ max: 2, connectionTimeoutMillis: 5_000 }),
      ])
    })
  },
)
