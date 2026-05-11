import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Principal } from "@/auth/principal"
import { ExperienceService } from "./experience.service"

// Mock Prisma client with chained methods
function mockPrisma() {
  const contentRevision = {
    create: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  }
  const experienceLocale = {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  }
  const experience = {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  }
  return {
    contentRevision,
    experience,
    experienceLocale,
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ contentRevision, experience, experienceLocale }),
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
const SYSTEM: Principal = { id: null, role: "SYSTEM" }
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

    it("SYSTEM cannot create (editorial isolation)", async () => {
      await expect(
        service.create({
          input: { locale: "en", slug: "nope" },
          user: SYSTEM,
        }),
      ).rejects.toThrow("Forbidden")
    })

    it("invalid blocks → Zod error", async () => {
      await expect(
        service.create({
          input: {
            locale: "en",
            slug: "bad-blocks",
            blocks: [{ t: "nonexistent_block_type" }],
          },
          user: ADMIN,
        }),
      ).rejects.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // createLocale
  // ---------------------------------------------------------------------------

  describe("createLocale", () => {
    const input = {
      experienceId: "exp-1",
      locale: "es",
      slug: "hello-world",
      title: "Hello",
      metaDescription: "Meta",
      blocks: [{ t: "text", heading: "Hello" }],
    }

    it("EDITOR can add a draft locale to an owned experience", async () => {
      prisma.experience.findUniqueOrThrow.mockResolvedValueOnce({
        ownerId: "alice",
        archivedAt: null,
      })
      prisma.experienceLocale.create.mockResolvedValueOnce({
        id: "loc-es",
        ...input,
        status: "DRAFT",
      })

      const result = await service.createLocale({
        input,
        user: EDITOR_ALICE,
      })

      expect(result.id).toBe("loc-es")
      expect(prisma.experienceLocale.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          locale: "es",
          slug: "hello-world",
          blocks: input.blocks,
          experience: { connect: { id: "exp-1" } },
        }),
      })
    })

    it("EDITOR cannot add a locale to another editor's experience", async () => {
      prisma.experience.findUniqueOrThrow.mockResolvedValueOnce({
        ownerId: "alice",
        archivedAt: null,
      })

      await expect(
        service.createLocale({
          input,
          user: EDITOR_BOB,
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

    it("EDITOR sees archived when includeArchived=true", async () => {
      prisma.experience.findMany.mockResolvedValueOnce([])

      await service.list({
        input: { includeArchived: true },
        user: EDITOR_ALICE,
        query: {},
      })

      const call = prisma.experience.findMany.mock.calls[0][0]
      expect(call.where).not.toHaveProperty("archivedAt")
    })

    it("VIEWER includeArchived=true is silently ignored", async () => {
      prisma.experience.findMany.mockResolvedValueOnce([])

      await service.list({
        input: { includeArchived: true },
        user: VIEWER,
        query: {},
      })

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
      experienceId: "exp-1",
      locale: "en",
      slug: "test-locale",
      isHomepage: false,
      pathSegment: null,
      status: "DRAFT",
      title: "Before",
      metaDescription: null,
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      blocks: [],
      publishedAt: null,
      createdAt: new Date("2026-04-15T12:00:00.000Z"),
      updatedAt: new Date("2026-04-15T12:00:00.000Z"),
      experience: { ownerId: "alice", archivedAt: null, isTemplate: false },
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
      expect(prisma.contentRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: "ExperienceLocale",
            entityId: "loc-1",
            status: "HISTORICAL",
          }),
        }),
      )
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

    it("updates template mode when provided", async () => {
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(localeRow)
      prisma.experience.update.mockResolvedValueOnce({
        id: "exp-1",
        isTemplate: true,
      })
      prisma.experienceLocale.update.mockResolvedValueOnce(localeRow)

      await service.updateLocale({
        input: { id: "loc-1", isTemplate: true },
        user: EDITOR_ALICE,
      })

      expect(prisma.experience.update).toHaveBeenCalledWith({
        where: { id: "exp-1" },
        data: { isTemplate: true },
      })
    })

    it("does not touch template mode when omitted", async () => {
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(localeRow)
      prisma.experienceLocale.update.mockResolvedValueOnce(localeRow)

      await service.updateLocale({
        input: { id: "loc-1", title: "No template change" },
        user: EDITOR_ALICE,
      })

      expect(prisma.experience.update).not.toHaveBeenCalled()
    })

    it("notifies watch revalidation after updating a published locale", async () => {
      const revalidateWatchExperience = vi.fn().mockResolvedValue({
        status: "revalidated",
        paths: ["/updated/en"],
      })
      service = new ExperienceService(prisma, revalidateWatchExperience)
      const publishedLocale = {
        ...localeRow,
        status: "PUBLISHED",
        publishedAt: new Date("2026-04-15T13:00:00.000Z"),
      }
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(
        publishedLocale,
      )
      prisma.experienceLocale.update.mockResolvedValueOnce({
        ...publishedLocale,
        slug: "updated-locale",
        title: "Updated",
      })

      await service.updateLocale({
        input: { id: "loc-1", slug: "updated-locale", title: "Updated" },
        user: EDITOR_ALICE,
      })

      expect(revalidateWatchExperience).toHaveBeenCalledWith({
        slug: "test-locale",
        locale: "en",
        isTemplate: false,
      })
      expect(revalidateWatchExperience).toHaveBeenCalledWith({
        slug: "updated-locale",
        locale: "en",
        isTemplate: false,
      })
    })

    it("does not fail the update when watch revalidation fails", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const revalidateWatchExperience = vi
        .fn()
        .mockRejectedValue(new Error("watch offline"))
      service = new ExperienceService(prisma, revalidateWatchExperience)
      const publishedLocale = {
        ...localeRow,
        status: "PUBLISHED",
        publishedAt: new Date("2026-04-15T13:00:00.000Z"),
      }
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(
        publishedLocale,
      )
      prisma.experienceLocale.update.mockResolvedValueOnce({
        ...publishedLocale,
        title: "Updated",
      })

      await expect(
        service.updateLocale({
          input: { id: "loc-1", title: "Updated" },
          user: EDITOR_ALICE,
        }),
      ).resolves.toMatchObject({ title: "Updated" })

      warnSpy.mockRestore()
    })

    it("SYSTEM cannot update locale (editorial isolation)", async () => {
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(localeRow)

      await expect(
        service.updateLocale({
          input: { id: "loc-1", title: "System Write" },
          user: SYSTEM,
        }),
      ).rejects.toThrow("Forbidden")
    })

    it("EDITOR cannot update locale on archived experience", async () => {
      const archivedLocale = {
        ...localeRow,
        experience: { ownerId: "alice", archivedAt: new Date() },
      }
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(
        archivedLocale,
      )

      await expect(
        service.updateLocale({
          input: { id: "loc-1", title: "Edit Archived" },
          user: EDITOR_ALICE,
        }),
      ).rejects.toThrow("Forbidden")
    })
  })

  // ---------------------------------------------------------------------------
  // publishLocale
  // ---------------------------------------------------------------------------

  describe("publishLocale", () => {
    it("EDITOR can publish own locale", async () => {
      const localeRow = {
        id: "loc-1",
        experienceId: "exp-1",
        locale: "en",
        slug: "publish-test",
        isHomepage: false,
        pathSegment: null,
        status: "DRAFT",
        title: "Before publish",
        metaDescription: null,
        ogTitle: null,
        ogDescription: null,
        ogImageUrl: null,
        blocks: [],
        publishedAt: null,
        createdAt: new Date("2026-04-15T12:00:00.000Z"),
        updatedAt: new Date("2026-04-15T12:00:00.000Z"),
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
      expect(prisma.experienceLocale.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "PUBLISHED",
            publishedAt: expect.any(Date),
          }),
        }),
      )
      expect(prisma.contentRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: "ExperienceLocale",
            entityId: "loc-1",
            status: "HISTORICAL",
          }),
        }),
      )
    })

    it("notifies watch revalidation after publishing", async () => {
      const revalidateWatchExperience = vi.fn().mockResolvedValue({
        status: "revalidated",
        paths: ["/publish-test/en"],
      })
      service = new ExperienceService(prisma, revalidateWatchExperience)
      const localeRow = {
        id: "loc-1",
        experienceId: "exp-1",
        locale: "en",
        slug: "publish-test",
        isHomepage: false,
        pathSegment: null,
        status: "DRAFT",
        title: "Before publish",
        metaDescription: null,
        ogTitle: null,
        ogDescription: null,
        ogImageUrl: null,
        blocks: [],
        publishedAt: null,
        createdAt: new Date("2026-04-15T12:00:00.000Z"),
        updatedAt: new Date("2026-04-15T12:00:00.000Z"),
        experience: { ownerId: "alice", archivedAt: null },
      }
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(localeRow)
      prisma.experienceLocale.update.mockResolvedValueOnce({
        ...localeRow,
        status: "PUBLISHED",
        publishedAt: new Date("2026-04-15T13:00:00.000Z"),
      })

      await service.publishLocale({
        input: { id: "loc-1" },
        user: EDITOR_ALICE,
      })

      expect(revalidateWatchExperience).toHaveBeenCalledWith({
        slug: "publish-test",
        locale: "en",
        isTemplate: false,
      })
    })

    it("VIEWER cannot publish", async () => {
      const localeRow = {
        id: "loc-1",
        experienceId: "exp-1",
        locale: "en",
        slug: "forbidden-publish",
        isHomepage: false,
        pathSegment: null,
        status: "DRAFT",
        title: "Draft",
        metaDescription: null,
        ogTitle: null,
        ogDescription: null,
        ogImageUrl: null,
        blocks: [],
        publishedAt: null,
        createdAt: new Date("2026-04-15T12:00:00.000Z"),
        updatedAt: new Date("2026-04-15T12:00:00.000Z"),
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
  // restoreLocaleRevision
  // ---------------------------------------------------------------------------

  describe("restoreLocaleRevision", () => {
    const localeRow = {
      id: "loc-1",
      experienceId: "exp-1",
      locale: "en",
      slug: "current-slug",
      isHomepage: false,
      pathSegment: "current",
      status: "PUBLISHED",
      title: "Current title",
      metaDescription: "Current meta",
      ogTitle: "Current OG",
      ogDescription: "Current OG description",
      ogImageUrl: "https://example.com/current.png",
      blocks: [{ t: "text", heading: "Current" }],
      publishedAt: new Date("2026-04-15T12:00:00.000Z"),
      createdAt: new Date("2026-04-15T10:00:00.000Z"),
      updatedAt: new Date("2026-04-15T12:00:00.000Z"),
      experience: { ownerId: "alice", archivedAt: null },
    }

    const revisionRow = {
      id: "rev-1",
      entityType: "ExperienceLocale",
      entityId: "loc-1",
      snapshot: {
        v: 1,
        data: {
          id: "loc-1",
          experienceId: "exp-1",
          locale: "en",
          slug: "restored-slug",
          isHomepage: true,
          pathSegment: "restored",
          title: "Restored title",
          metaDescription: "Restored meta",
          ogTitle: "Restored OG",
          ogDescription: "Restored OG description",
          ogImageUrl: "https://example.com/restored.png",
          blocks: [{ t: "text", heading: "Restored" }],
          status: "DRAFT",
          publishedAt: null,
        },
      },
      status: "HISTORICAL",
      revisedBy: "alice",
      revisedByKind: "USER",
      reason: "Locale updated from admin editor",
      revisedAt: new Date("2026-04-15T11:00:00.000Z"),
      appliedAt: null,
    }

    it("EDITOR can restore own locale revision", async () => {
      prisma.contentRevision.findUniqueOrThrow.mockResolvedValueOnce(
        revisionRow,
      )
      prisma.contentRevision.update.mockResolvedValueOnce({
        ...revisionRow,
        appliedAt: new Date("2026-04-15T12:30:00.000Z"),
      })
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(localeRow)
      prisma.experienceLocale.update.mockResolvedValueOnce({
        ...localeRow,
        slug: "restored-slug",
        title: "Restored title",
        status: "DRAFT",
      })

      const result = await service.restoreLocaleRevision({
        input: { revisionId: "rev-1" },
        user: EDITOR_ALICE,
      })

      expect(result.slug).toBe("restored-slug")
      expect(prisma.contentRevision.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "rev-1" },
          data: expect.objectContaining({
            appliedAt: expect.any(Date),
          }),
        }),
      )
      expect(prisma.experienceLocale.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "loc-1" },
          data: expect.objectContaining({
            slug: "restored-slug",
            title: "Restored title",
            pathSegment: "restored",
            isHomepage: true,
            status: "DRAFT",
          }),
        }),
      )
    })

    it("EDITOR cannot restore another editor's locale revision", async () => {
      prisma.contentRevision.findUniqueOrThrow.mockResolvedValueOnce(
        revisionRow,
      )
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(localeRow)

      await expect(
        service.restoreLocaleRevision({
          input: { revisionId: "rev-1" },
          user: EDITOR_BOB,
        }),
      ).rejects.toThrow("Forbidden")
    })

    it("rejects revisions without a valid snapshot payload", async () => {
      prisma.contentRevision.findUniqueOrThrow.mockResolvedValueOnce({
        ...revisionRow,
        snapshot: { v: 1 },
      })

      await expect(
        service.restoreLocaleRevision({
          input: { revisionId: "rev-1" },
          user: ADMIN,
        }),
      ).rejects.toThrow("Revision snapshot is invalid.")
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

    it("throws when experience not found", async () => {
      prisma.experience.findFirst.mockResolvedValueOnce(null)

      await expect(
        service.archive({ input: { id: "missing" }, user: ADMIN }),
      ).rejects.toThrow("not found")
    })

    it("SYSTEM cannot archive (editorial isolation)", async () => {
      const exp = { id: "exp-1", ownerId: "alice", archivedAt: null }
      prisma.experience.findFirst.mockResolvedValueOnce(exp)

      await expect(
        service.archive({ input: { id: "exp-1" }, user: SYSTEM }),
      ).rejects.toThrow("Forbidden")
    })
  })

  // ---------------------------------------------------------------------------
  // getBySlug — archived parent filtering
  // ---------------------------------------------------------------------------

  describe("getBySlug", () => {
    it("PUBLIC cannot see locale of archived experience", async () => {
      prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)

      await service.getBySlug({
        locale: "en",
        slug: "archived-page",
        user: PUBLIC_USER,
        query: {},
      })

      const call = prisma.experienceLocale.findFirst.mock.calls[0][0]
      expect(call.where.experience).toEqual({ archivedAt: null })
    })

    it("VIEWER sees published only", async () => {
      prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)

      await service.getBySlug({
        locale: "en",
        slug: "test",
        user: VIEWER,
        query: {},
      })

      const call = prisma.experienceLocale.findFirst.mock.calls[0][0]
      expect(call.where).toHaveProperty("status", "PUBLISHED")
      expect(call.where.experience).toEqual({ archivedAt: null })
    })
  })
})
