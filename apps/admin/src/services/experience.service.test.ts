import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Principal } from "@/auth/principal"
import { ExperienceService } from "./experience.service"

// Mock Prisma client with chained methods
function mockPrisma() {
  const experienceLocale = {
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  }
  const experience = {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  }
  return {
    experience,
    experienceLocale,
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ experience, experienceLocale }),
    ),
  } as unknown as Parameters<
    (typeof ExperienceService)["prototype"]["list"]
  > extends never
    ? never
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
}

const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }
const EDITOR_ALICE: Principal = { id: "alice", role: "EDITOR" }
const EDITOR_BOB: Principal = { id: "bob", role: "EDITOR" }
const VIEWER: Principal = { id: "viewer-1", role: "VIEWER" }
const PUBLIC_USER: Principal | null = null

describe("ExperienceService", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: ExperienceService

  beforeEach(() => {
    prisma = mockPrisma()
    service = new ExperienceService(prisma)
  })

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  describe("create", () => {
    it("ADMIN can create an experience", async () => {
      const created = {
        id: "exp-1",
        isTemplate: false,
        ownerId: "admin-1",
        locales: [{ id: "loc-1" }],
      }
      prisma.experience.create.mockResolvedValueOnce(created)

      const result = await service.create({
        input: { locale: "en", slug: "hello-world", title: "Hello" },
        user: ADMIN,
      })

      expect(result).toEqual(created)
      expect(prisma.experience.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerId: "admin-1",
            locales: expect.objectContaining({
              create: expect.objectContaining({
                locale: "en",
                slug: "hello-world",
                title: "Hello",
              }),
            }),
          }),
        }),
      )
    })

    it("EDITOR can create an experience (becomes owner)", async () => {
      prisma.experience.create.mockResolvedValueOnce({ id: "exp-2" })

      await service.create({
        input: { locale: "en", slug: "my-page" },
        user: EDITOR_ALICE,
      })

      expect(prisma.experience.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ownerId: "alice" }),
        }),
      )
    })

    it("VIEWER cannot create", async () => {
      await expect(
        service.create({
          input: { locale: "en", slug: "nope" },
          user: VIEWER,
        }),
      ).rejects.toThrow("Forbidden")
    })

    it("PUBLIC cannot create", async () => {
      await expect(
        service.create({
          input: { locale: "en", slug: "nope" },
          user: PUBLIC_USER,
        }),
      ).rejects.toThrow("Forbidden")
    })
  })

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------

  describe("list", () => {
    it("ADMIN sees all including archived", async () => {
      prisma.experience.findMany.mockResolvedValueOnce([])

      await service.list({
        input: { includeArchived: true },
        user: ADMIN,
        query: {},
      })

      const call = prisma.experience.findMany.mock.calls[0][0]
      expect(call.where).not.toHaveProperty("archivedAt")
    })

    it("VIEWER does not see archived", async () => {
      prisma.experience.findMany.mockResolvedValueOnce([])

      await service.list({ input: {}, user: VIEWER, query: {} })

      const call = prisma.experience.findMany.mock.calls[0][0]
      expect(call.where).toHaveProperty("archivedAt", null)
    })

    it("PUBLIC cannot list", async () => {
      await expect(
        service.list({ input: {}, user: PUBLIC_USER, query: {} }),
      ).rejects.toThrow("Forbidden")
    })
  })

  // ---------------------------------------------------------------------------
  // getById
  // ---------------------------------------------------------------------------

  describe("getById", () => {
    it("ADMIN can get any experience", async () => {
      const exp = { id: "exp-1", ownerId: "alice", archivedAt: null }
      prisma.experience.findFirst.mockResolvedValueOnce(exp)

      const result = await service.getById({
        id: "exp-1",
        user: ADMIN,
        query: {},
      })

      expect(result).toEqual(exp)
    })

    it("VIEWER cannot see archived", async () => {
      prisma.experience.findFirst.mockResolvedValueOnce(null)

      const result = await service.getById({
        id: "exp-1",
        user: VIEWER,
        query: {},
      })

      expect(result).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // getBySlug
  // ---------------------------------------------------------------------------

  describe("getBySlug", () => {
    it("PUBLIC can get published locale by slug", async () => {
      const locale = { id: "loc-1", slug: "hello", status: "PUBLISHED" }
      prisma.experienceLocale.findFirst.mockResolvedValueOnce(locale)

      const result = await service.getBySlug({
        locale: "en",
        slug: "hello",
        user: PUBLIC_USER,
        query: {},
      })

      expect(result).toEqual(locale)
      const call = prisma.experienceLocale.findFirst.mock.calls[0][0]
      expect(call.where).toHaveProperty("status", "PUBLISHED")
    })

    it("EDITOR can get draft locales by slug", async () => {
      const locale = { id: "loc-2", slug: "draft-page", status: "DRAFT" }
      prisma.experienceLocale.findFirst.mockResolvedValueOnce(locale)

      const result = await service.getBySlug({
        locale: "en",
        slug: "draft-page",
        user: EDITOR_ALICE,
        query: {},
      })

      expect(result).toEqual(locale)
      const call = prisma.experienceLocale.findFirst.mock.calls[0][0]
      expect(call.where).not.toHaveProperty("status")
    })
  })

  // ---------------------------------------------------------------------------
  // updateLocale
  // ---------------------------------------------------------------------------

  describe("updateLocale", () => {
    const localeRow = {
      id: "loc-1",
      status: "DRAFT",
      experience: { ownerId: "alice", archivedAt: null },
    }

    it("EDITOR can update own locale", async () => {
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(localeRow)
      prisma.experienceLocale.update.mockResolvedValueOnce({
        ...localeRow,
        title: "Updated",
      })

      const result = await service.updateLocale({
        input: { id: "loc-1", title: "Updated" },
        user: EDITOR_ALICE,
      })

      expect(result.title).toBe("Updated")
    })

    it("EDITOR cannot update another editor's locale", async () => {
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(localeRow)

      await expect(
        service.updateLocale({
          input: { id: "loc-1", title: "Hijack" },
          user: EDITOR_BOB,
        }),
      ).rejects.toThrow("Forbidden")
    })

    it("ADMIN can update any locale", async () => {
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(localeRow)
      prisma.experienceLocale.update.mockResolvedValueOnce({
        ...localeRow,
        title: "Admin Edit",
      })

      const result = await service.updateLocale({
        input: { id: "loc-1", title: "Admin Edit" },
        user: ADMIN,
      })

      expect(result.title).toBe("Admin Edit")
    })
  })

  // ---------------------------------------------------------------------------
  // publishLocale
  // ---------------------------------------------------------------------------

  describe("publishLocale", () => {
    it("EDITOR can publish own locale", async () => {
      const localeRow = {
        id: "loc-1",
        status: "DRAFT",
        experience: { ownerId: "alice", archivedAt: null },
      }
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(localeRow)
      prisma.experienceLocale.update.mockResolvedValueOnce({
        ...localeRow,
        status: "PUBLISHED",
      })

      const result = await service.publishLocale({
        input: { id: "loc-1" },
        user: EDITOR_ALICE,
      })

      expect(result.status).toBe("PUBLISHED")
    })

    it("VIEWER cannot publish", async () => {
      const localeRow = {
        id: "loc-1",
        status: "DRAFT",
        experience: { ownerId: "alice", archivedAt: null },
      }
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(localeRow)

      await expect(
        service.publishLocale({
          input: { id: "loc-1" },
          user: VIEWER,
        }),
      ).rejects.toThrow("Forbidden")
    })
  })

  // ---------------------------------------------------------------------------
  // archive
  // ---------------------------------------------------------------------------

  describe("archive", () => {
    it("EDITOR can archive own experience", async () => {
      const exp = { id: "exp-1", ownerId: "alice", archivedAt: null }
      prisma.experience.findFirst.mockResolvedValueOnce(exp)
      prisma.experience.update.mockResolvedValueOnce({
        ...exp,
        archivedAt: new Date(),
      })

      const result = await service.archive({
        input: { id: "exp-1" },
        user: EDITOR_ALICE,
      })

      expect(result.archivedAt).not.toBeNull()
    })

    it("EDITOR cannot archive another editor's experience", async () => {
      const exp = { id: "exp-1", ownerId: "alice", archivedAt: null }
      prisma.experience.findFirst.mockResolvedValueOnce(exp)

      await expect(
        service.archive({
          input: { id: "exp-1" },
          user: EDITOR_BOB,
        }),
      ).rejects.toThrow("Forbidden")
    })

    it("ADMIN can archive any experience", async () => {
      const exp = { id: "exp-1", ownerId: "alice", archivedAt: null }
      prisma.experience.findFirst.mockResolvedValueOnce(exp)
      prisma.experience.update.mockResolvedValueOnce({
        ...exp,
        archivedAt: new Date(),
      })

      await service.archive({ input: { id: "exp-1" }, user: ADMIN })

      expect(prisma.experience.update).toHaveBeenCalled()
    })
  })
})
