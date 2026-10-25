import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Principal } from "@/auth/principal"
import { ExperienceSearchService } from "./experience.search"

function mockPrisma() {
  const $executeRaw = vi.fn()
  const $queryRaw = vi.fn()
  return {
    $executeRaw,
    $queryRaw,
    // $transaction receives a callback; invoke it with a tx that has the
    // same $executeRaw/$queryRaw mocks so assertions work transparently.
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $executeRaw, $queryRaw }),
    ),
    experienceLocale: {
      findMany: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }
const VIEWER: Principal = { id: "viewer-1", role: "VIEWER" }
const PUBLIC_USER: Principal | null = null

const VECTOR = Array.from({ length: 2048 }, () => 0.1)

describe("ExperienceSearchService", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: ExperienceSearchService

  beforeEach(() => {
    prisma = mockPrisma()
    service = new ExperienceSearchService(prisma)
  })

  it("wraps SET LOCAL + search in a $transaction", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    await service.search({ vector: VECTOR, user: ADMIN, query: {} })

    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.$executeRaw).toHaveBeenCalled()
  })

  it("returns empty array when no hits", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    const result = await service.search({
      vector: VECTOR,
      user: ADMIN,
      query: {},
    })

    expect(result).toEqual([])
    expect(prisma.experienceLocale.findMany).not.toHaveBeenCalled()
  })

  it("hydrates results preserving search order", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: "loc-2", distance: 0.1 },
      { id: "loc-1", distance: 0.3 },
      { id: "loc-3", distance: 0.5 },
    ])
    prisma.experienceLocale.findMany.mockResolvedValueOnce([
      { id: "loc-3", slug: "third" },
      { id: "loc-1", slug: "first" },
      { id: "loc-2", slug: "second" },
    ])

    const result = await service.search({
      vector: VECTOR,
      user: ADMIN,
      query: {},
    })

    expect(result.map((r: { id: string }) => r.id)).toEqual([
      "loc-2",
      "loc-1",
      "loc-3",
    ])
  })

  it("PUBLIC search applies published + non-archived filters at hydration", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "loc-1", distance: 0.1 }])
    prisma.experienceLocale.findMany.mockResolvedValueOnce([])

    await service.search({ vector: VECTOR, user: PUBLIC_USER, query: {} })

    const call = prisma.experienceLocale.findMany.mock.calls[0][0]
    expect(call.where).toHaveProperty("status", "PUBLISHED")
    expect(call.where).toHaveProperty("experience", { archivedAt: null })
  })

  it("ADMIN search does not apply status/archive filters at hydration", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "loc-1", distance: 0.1 }])
    prisma.experienceLocale.findMany.mockResolvedValueOnce([
      { id: "loc-1", slug: "test" },
    ])

    await service.search({ vector: VECTOR, user: ADMIN, query: {} })

    const call = prisma.experienceLocale.findMany.mock.calls[0][0]
    expect(call.where).not.toHaveProperty("status")
    expect(call.where).not.toHaveProperty("experience")
  })

  it("filters by locale when provided", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    await service.search({
      vector: VECTOR,
      locale: "en",
      user: VIEWER,
      query: {},
    })

    expect(prisma.$queryRaw).toHaveBeenCalled()
  })

  it("drops hydration misses (race between raw SQL and Prisma)", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: "loc-1", distance: 0.1 },
      { id: "loc-2", distance: 0.2 },
      { id: "loc-3", distance: 0.3 },
    ])
    // loc-2 was unpublished between raw SQL and hydration
    prisma.experienceLocale.findMany.mockResolvedValueOnce([
      { id: "loc-1", slug: "a" },
      { id: "loc-3", slug: "c" },
    ])

    const result = await service.search({
      vector: VECTOR,
      user: ADMIN,
      query: {},
    })

    expect(result).toHaveLength(2)
    expect(result.map((r: { id: string }) => r.id)).toEqual(["loc-1", "loc-3"])
  })

  it("rejects non-array vector input", async () => {
    await expect(
      service.search({ vector: "not an array", user: ADMIN, query: {} }),
    ).rejects.toThrow("vector must be an array")
  })

  it("rejects vector with non-finite numbers", async () => {
    await expect(
      service.search({
        vector: [1, 2, NaN, 4],
        user: ADMIN,
        query: {},
      }),
    ).rejects.toThrow("not a finite number")
  })
})
