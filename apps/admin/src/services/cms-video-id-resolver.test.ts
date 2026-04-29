// Tests for the cms-video-id resolver.
//
// Uses a fake `pg.Pool` that records queries and returns canned
// rows + a fake Prisma client that returns admin Video lookups.
// Verifies the join logic (cms id → coreId → admin cuid) without
// touching real databases.

import { describe, expect, it, vi } from "vitest"
import {
  adminVideoIdLookup,
  createCmsVideoIdResolver,
} from "./cms-video-id-resolver"

type FakePoolQueryResult<T> = { rows: T[] }

function createFakePool(handler: (sql: string, params: unknown[]) => unknown) {
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    return { rows: handler(sql, params) ?? [] } as FakePoolQueryResult<unknown>
  })
  // The resolver only needs `.query()`. Cast to satisfy the Pool
  // shape without pulling in the real `pg` types in tests.
  return { query } as unknown as import("pg").Pool & { query: typeof query }
}

function createFakePrisma(adminVideos: { id: string; coreId: string }[]) {
  const findMany = vi.fn(
    async ({ where }: { where: { coreId: { in: string[] } } }) => {
      return adminVideos.filter((v) => where.coreId.in.includes(v.coreId))
    },
  )
  return {
    video: { findMany },
  } as unknown as import("@prisma/client").PrismaClient
}

describe("createCmsVideoIdResolver", () => {
  it("returns an empty map when given an empty input set", async () => {
    const pool = createFakePool(() => [])
    const prisma = createFakePrisma([])
    const resolver = createCmsVideoIdResolver(pool, prisma)
    const result = await resolver.resolve(new Set())
    expect(result.size).toBe(0)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it("resolves cms ids → coreId → admin cuid for happy path", async () => {
    const pool = createFakePool((sql, params) => {
      if (sql.includes("FROM videos")) {
        const ids = params[0] as number[]
        return ids.map((id) => ({ id, core_id: `core-${id}` }))
      }
      return []
    })
    const prisma = createFakePrisma([
      { id: "admin-cuid-1", coreId: "core-1" },
      { id: "admin-cuid-2", coreId: "core-2" },
    ])
    const resolver = createCmsVideoIdResolver(pool, prisma)
    const result = await resolver.resolve(new Set([1, 2]))
    expect(result.get(1)).toEqual({
      coreId: "core-1",
      adminVideoId: "admin-cuid-1",
    })
    expect(result.get(2)).toEqual({
      coreId: "core-2",
      adminVideoId: "admin-cuid-2",
    })
  })

  it("returns null adminVideoId for cms videos with no coreId", async () => {
    const pool = createFakePool(() => [{ id: 7, core_id: null }])
    const prisma = createFakePrisma([])
    const resolver = createCmsVideoIdResolver(pool, prisma)
    const result = await resolver.resolve(new Set([7]))
    expect(result.get(7)).toEqual({ coreId: null, adminVideoId: null })
  })

  it("returns null adminVideoId for coreIds with no matching admin Video", async () => {
    const pool = createFakePool(() => [{ id: 8, core_id: "core-orphan" }])
    const prisma = createFakePrisma([
      { id: "admin-other", coreId: "core-other" },
    ])
    const resolver = createCmsVideoIdResolver(pool, prisma)
    const result = await resolver.resolve(new Set([8]))
    expect(result.get(8)).toEqual({ coreId: "core-orphan", adminVideoId: null })
  })

  it("returns null adminVideoId for cms ids that don't exist in cms.videos at all", async () => {
    const pool = createFakePool(() => [])
    const prisma = createFakePrisma([])
    const resolver = createCmsVideoIdResolver(pool, prisma)
    const result = await resolver.resolve(new Set([999]))
    expect(result.get(999)).toEqual({ coreId: null, adminVideoId: null })
  })

  it("issues exactly one cms.videos query and one admin.video query", async () => {
    const pool = createFakePool(() => [
      { id: 1, core_id: "c-1" },
      { id: 2, core_id: "c-2" },
    ])
    const prisma = createFakePrisma([{ id: "a-1", coreId: "c-1" }])
    const resolver = createCmsVideoIdResolver(pool, prisma)
    await resolver.resolve(new Set([1, 2]))
    expect(pool.query).toHaveBeenCalledTimes(1)
    expect(prisma.video.findMany).toHaveBeenCalledTimes(1)
  })

  it("skips the admin.video query when no cms videos have coreIds", async () => {
    const pool = createFakePool(() => [
      { id: 1, core_id: null },
      { id: 2, core_id: null },
    ])
    const prisma = createFakePrisma([])
    const resolver = createCmsVideoIdResolver(pool, prisma)
    await resolver.resolve(new Set([1, 2]))
    expect(prisma.video.findMany).not.toHaveBeenCalled()
  })
})

describe("adminVideoIdLookup", () => {
  it("returns the admin cuid for a present resolution", () => {
    const lookup = adminVideoIdLookup(
      new Map([[1, { coreId: "c-1", adminVideoId: "a-1" }]]),
    )
    expect(lookup(1)).toBe("a-1")
  })

  it("returns undefined for a null cmsVideoId argument", () => {
    const lookup = adminVideoIdLookup(new Map())
    expect(lookup(null)).toBeUndefined()
  })

  it("returns undefined for a resolution with null adminVideoId", () => {
    const lookup = adminVideoIdLookup(
      new Map([[2, { coreId: "c-2", adminVideoId: null }]]),
    )
    expect(lookup(2)).toBeUndefined()
  })

  it("returns undefined for an unseen cmsVideoId", () => {
    const lookup = adminVideoIdLookup(new Map())
    expect(lookup(999)).toBeUndefined()
  })
})
