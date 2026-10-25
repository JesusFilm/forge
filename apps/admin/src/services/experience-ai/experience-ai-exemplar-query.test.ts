import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  findExperienceExemplar,
  findFallbackExperienceExemplar,
} from "./experience-ai-exemplar-query"

function mockPrisma() {
  const $executeRaw = vi.fn()
  const $queryRaw = vi.fn()
  return {
    $executeRaw,
    $queryRaw,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $executeRaw, $queryRaw }),
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const VECTOR = Array.from({ length: 8 }, () => 0.1)

describe("findExperienceExemplar", () => {
  let prisma: ReturnType<typeof mockPrisma>
  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("hydrates structure + distance in one $transaction query, in distance order", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: "loc-2",
        locale: "en",
        title: "Second",
        metaDescription: null,
        blocks: [],
        distance: 0.12,
      },
      {
        id: "loc-1",
        locale: "en",
        title: "First",
        metaDescription: null,
        blocks: [],
        distance: 0.34,
      },
    ])

    const result = await findExperienceExemplar(prisma, {
      vector: VECTOR,
      locale: "en",
    })

    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.$executeRaw).toHaveBeenCalled() // SET LOCAL ef_search
    expect(result.map((r) => r.id)).toEqual(["loc-2", "loc-1"])
    expect(result[0]!.distance).toBe(0.12)
    expect(result[0]!.title).toBe("Second")
  })

  it("returns [] when there are no matches", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    const result = await findExperienceExemplar(prisma, { vector: VECTOR })
    expect(result).toEqual([])
  })

  it("rejects non-array vector input", async () => {
    await expect(
      findExperienceExemplar(prisma, { vector: "nope" }),
    ).rejects.toThrow("vector must be an array")
  })

  it("rejects vector with non-finite numbers", async () => {
    await expect(
      findExperienceExemplar(prisma, { vector: [1, 2, NaN] }),
    ).rejects.toThrow("not a finite number")
  })
})

describe("findFallbackExperienceExemplar", () => {
  let prisma: ReturnType<typeof mockPrisma>
  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("returns null when no published locale matches the slug", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    expect(
      await findFallbackExperienceExemplar(prisma, { slug: "easter" }),
    ).toBeNull()
  })

  it("prefers the requested locale and sets distance to null", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: "loc-en",
        locale: "en",
        title: "Easter",
        metaDescription: null,
        blocks: [],
      },
      {
        id: "loc-es",
        locale: "es",
        title: "Pascua",
        metaDescription: null,
        blocks: [],
      },
    ])

    const result = await findFallbackExperienceExemplar(prisma, {
      slug: "easter",
      locale: "es",
    })

    expect(result?.id).toBe("loc-es")
    expect(result?.distance).toBeNull()
  })

  it("falls back to the first row when the requested locale is absent", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: "loc-en",
        locale: "en",
        title: "Easter",
        metaDescription: null,
        blocks: [],
      },
    ])

    const result = await findFallbackExperienceExemplar(prisma, {
      slug: "easter",
      locale: "fr",
    })

    expect(result?.id).toBe("loc-en")
  })
})
