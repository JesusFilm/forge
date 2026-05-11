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

const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }
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
    it("VIEWER can list videos", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])

      await service.list({ input: {}, user: VIEWER, query: {} })

      const call = prisma.video.findMany.mock.calls[0][0]
      expect(call.where).toHaveProperty("deletedAt", null)
    })

    it("PUBLIC cannot list videos", async () => {
      await expect(
        service.list({ input: {}, user: PUBLIC_USER, query: {} }),
      ).rejects.toThrow("Forbidden")
    })

    it("clamps limit to 200", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])

      await service.list({
        input: { limit: 500 },
        user: VIEWER,
        query: {},
      })

      const call = prisma.video.findMany.mock.calls[0][0]
      expect(call.take).toBe(200)
    })
  })

  describe("getById", () => {
    it("VIEWER can get by id", async () => {
      prisma.video.findFirst.mockResolvedValueOnce({ id: "v-1" })

      const result = await service.getById({
        id: "v-1",
        user: VIEWER,
        query: {},
      })

      expect(result).toEqual({ id: "v-1" })
      expect(prisma.video.findFirst.mock.calls[0][0].where).toHaveProperty(
        "deletedAt",
        null,
      )
    })

    it("PUBLIC cannot get by id", async () => {
      await expect(
        service.getById({ id: "v-1", user: PUBLIC_USER, query: {} }),
      ).rejects.toThrow("Forbidden")
    })
  })

  describe("getBySlug", () => {
    it("ADMIN can get by slug", async () => {
      prisma.video.findFirst.mockResolvedValueOnce({ id: "v-1", slug: "jf" })

      await service.getBySlug({ slug: "jf", user: ADMIN, query: {} })

      expect(prisma.video.findFirst).toHaveBeenCalled()
    })

    it("PUBLIC can get by slug when explicitly allowed", async () => {
      prisma.video.findFirst.mockResolvedValueOnce({ id: "v-1", slug: "jf" })

      const result = await service.getBySlug({
        slug: "jf",
        user: PUBLIC_USER,
        query: {},
        allowPublic: true,
        publicLocale: "en",
      })

      expect(result).toEqual({ id: "v-1", slug: "jf" })
      expect(prisma.video.findFirst.mock.calls[0][0].where).toEqual({
        slug: "jf",
        deletedAt: null,
        locales: { some: { locale: "en", status: "PUBLISHED" } },
      })
    })

    it("PUBLIC cannot get by slug unless public access is explicit", async () => {
      await expect(
        service.getBySlug({ slug: "jf", user: PUBLIC_USER, query: {} }),
      ).rejects.toThrow("Forbidden")
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
  })
})
