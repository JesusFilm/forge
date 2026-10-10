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
}
const original = { prisma: cache.prisma, syncPrisma: cache.syncPrisma }

beforeEach(() => {
  vi.resetModules()
  adapters.length = 0
  clients.length = 0
  delete cache.prisma
  delete cache.syncPrisma
  vi.stubEnv("DATABASE_URL", "postgresql://localhost:1/module_cache_test")
})

afterEach(() => {
  vi.unstubAllEnvs()
  if (original.prisma === undefined) delete cache.prisma
  else cache.prisma = original.prisma
  if (original.syncPrisma === undefined) delete cache.syncPrisma
  else cache.syncPrisma = original.syncPrisma
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
      expect(first.prisma).not.toBe(first.syncPrisma)
      expect(clients).toHaveLength(2)
      expect(adapters).toEqual([
        expect.objectContaining({ max: 10, connectionTimeoutMillis: 20_000 }),
        expect.objectContaining({ max: 5, connectionTimeoutMillis: 60_000 }),
      ])
    })
  },
)
