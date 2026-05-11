import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Principal } from "@/auth/principal"
import { VideoService } from "./video.service"

function mockPrisma() {
  return {
    video: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const VIEWER: Principal = { id: "viewer-1", role: "VIEWER" }
const PUBLIC_USER: Principal | null = null

describe("VideoService", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: VideoService

  beforeEach(() => {
    prisma = mockPrisma()
    service = new VideoService(prisma)
  })

  describe("list", () => {
    it("returns non-deleted videos ordered by updatedAt", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])

      await service.list({ input: {}, query: {} })

      const call = prisma.video.findMany.mock.calls[0][0]
      expect(call.where).toHaveProperty("deletedAt", null)
      expect(call.orderBy).toEqual({ updatedAt: "desc" })
    })

    it("clamps limit to 200", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])

      await service.list({ input: { limit: 500 }, query: {} })

      const call = prisma.video.findMany.mock.calls[0][0]
      expect(call.take).toBe(200)
    })

    // U2 (2026-05-11): resolver authScopes is the sole gate for list/getById/
    // getBySlug. Re-adding a `user` param here breaks this assertion.
    it("does not require a user principal (resolver-only auth contract)", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])
      await expect(
        service.list({ input: {}, query: {} }),
      ).resolves.not.toThrow()
    })
  })

  describe("getById", () => {
    it("returns the matching non-deleted row", async () => {
      prisma.video.findFirst.mockResolvedValueOnce({ id: "v-1" })

      const result = await service.getById({ id: "v-1", query: {} })

      expect(result).toEqual({ id: "v-1" })
      expect(prisma.video.findFirst.mock.calls[0][0].where).toHaveProperty(
        "deletedAt",
        null,
      )
    })
  })

  describe("getBySlug", () => {
    it("returns the matching non-deleted row", async () => {
      prisma.video.findFirst.mockResolvedValueOnce({ id: "v-1", slug: "jf" })

      const result = await service.getBySlug({ slug: "jf", query: {} })

      expect(result).toEqual({ id: "v-1", slug: "jf" })
    })
  })

  describe("getByCoreId", () => {
    it("VIEWER can get by coreId", async () => {
      prisma.video.findFirst.mockResolvedValueOnce({
        id: "v-1",
        coreId: "core-1",
      })

      await service.getByCoreId({
        coreId: "core-1",
        user: VIEWER,
        query: {},
      })

      expect(prisma.video.findFirst.mock.calls[0][0].where).toHaveProperty(
        "coreId",
        "core-1",
      )
    })

    it("PUBLIC cannot get by coreId (Core sync internal — auth wall stays at the service)", async () => {
      await expect(
        service.getByCoreId({
          coreId: "core-1",
          user: PUBLIC_USER,
          query: {},
        }),
      ).rejects.toThrow("Forbidden")
    })
  })
})
