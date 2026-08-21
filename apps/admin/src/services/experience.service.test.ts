import { describe, expect, it, vi, beforeEach } from "vitest"
import { after } from "next/server"
import type { Principal } from "@/auth/principal"
import { ExperienceService } from "./experience.service"
import { refreshWatchRouteManifest } from "./watch-route-manifest-refresh.service"

// Override only `after` so the service's manifest-refresh scheduling is
// observable; everything else in next/server stays real.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>()
  return { ...actual, after: vi.fn() }
})

vi.mock("./watch-route-manifest-refresh.service", () => ({
  refreshWatchRouteManifest: vi.fn().mockResolvedValue({ status: "refreshed" }),
}))

// Mock Prisma client with chained methods
function mockPrisma() {
  const contentRevision = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "rev-created",
      revisedAt: new Date("2026-04-15T12:30:00.000Z"),
      ...data,
    })),
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(async ({ where, data }) => ({ ...where, ...data })),
  }
  const seoProposalMaterialization = { updateMany: vi.fn() }
  const experienceLocale = {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  }
  const experience = {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  }
  // Shared across the top-level client and the transaction client so the
  // applyChatMutation baseline read and the FOR UPDATE locked read both
  // resolve through the same mock (call order: baseline, then locked).
  const $queryRaw = vi.fn()
  return {
    contentRevision,
    experience,
    experienceLocale,
    $queryRaw,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Service authorization reads happen immediately before a transaction;
      // replay that row for the locked in-transaction read unless a test
      // explicitly queued another result.
      const priorLocaleRead =
        experienceLocale.findUniqueOrThrow.mock.results.at(-1)?.value
      if (priorLocaleRead) {
        experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(
          await priorLocaleRead,
        )
      }
      return fn({
        contentRevision,
        experience,
        experienceLocale,
        seoProposalMaterialization,
        $queryRaw,
      })
    }),
    seoProposalMaterialization,
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
const CONSUMER_BEARER_USER: Principal = {
  id: null,
  role: "CONSUMER_BEARER",
  rateLimitBucketKey: "test-bucket",
}

describe("ExperienceService", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: ExperienceService

  beforeEach(() => {
    prisma = mockPrisma()
    service = new ExperienceService(prisma)
    vi.mocked(refreshWatchRouteManifest).mockClear()
    vi.mocked(after).mockClear()
  })

  describe("getLocaleDraftState", () => {
    const locale = {
      id: "loc-state",
      experienceId: "exp-state",
      locale: "en",
      slug: "live",
      isHomepage: false,
      pathSegment: null,
      title: "Live title",
      metaDescription: null,
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      blocks: [],
      status: "PUBLISHED",
      publishedAt: new Date(),
      experience: {
        ownerId: "alice",
        archivedAt: null,
        isTemplate: false,
      },
    }

    it("rejects a non-owner before reading or exposing the active draft", async () => {
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(locale)

      await expect(
        service.getLocaleDraftState({ id: locale.id, user: EDITOR_BOB }),
      ).rejects.toThrow("Forbidden")

      expect(prisma.contentRevision.findFirst).not.toHaveBeenCalled()
      expect(prisma.contentRevision.update).not.toHaveBeenCalled()
    })

    it("atomically adopts an SEO-created draft without a preview token", async () => {
      const seoDraft = {
        id: "seo-draft",
        entityType: "ExperienceLocale",
        entityId: locale.id,
        status: "DRAFT",
        previewToken: null,
        snapshot: { v: 1, data: { title: "SEO title" } },
      }
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(locale)
      prisma.contentRevision.findFirst.mockResolvedValueOnce(seoDraft)
      prisma.contentRevision.update.mockImplementationOnce(
        async ({ data }: { data: Record<string, unknown> }) => ({
          ...seoDraft,
          ...data,
        }),
      )

      const state = await service.getLocaleDraftState({
        id: locale.id,
        user: EDITOR_ALICE,
      })

      expect(state.effective.title).toBe("SEO title")
      expect(state.activeDraft?.previewToken).toEqual(expect.any(String))
      expect(prisma.contentRevision.update).toHaveBeenCalledWith({
        where: { id: "seo-draft" },
        data: { previewToken: expect.any(String) },
      })
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: "ReadCommitted",
      })
    })
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
        locales: [
          {
            id: "loc-1",
            experienceId: "exp-1",
            locale: "en",
            slug: "hello-world",
            isHomepage: false,
            pathSegment: null,
            title: null,
            metaDescription: null,
            ogTitle: null,
            ogDescription: null,
            ogImageUrl: null,
            blocks: [],
            status: "DRAFT",
            publishedAt: null,
          },
        ],
      }
      prisma.experience.create.mockResolvedValueOnce(created)

      const result = await service.create({
        input: { locale: "en", slug: "hello-world", title: "Hello" },
        user: ADMIN,
      })

      expect(result).toEqual({
        ...created,
        locales: [expect.objectContaining({ title: "Hello" })],
      })
      expect(prisma.experience.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerId: "admin-1",
            locales: expect.objectContaining({
              create: expect.objectContaining({
                locale: "en",
                slug: "hello-world",
                blocks: [],
              }),
            }),
          }),
        }),
      )
      expect(prisma.contentRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "DRAFT",
            snapshot: expect.objectContaining({
              data: expect.objectContaining({ title: "Hello" }),
            }),
          }),
        }),
      )
    })

    it("EDITOR can create an experience (becomes owner)", async () => {
      prisma.experience.create.mockResolvedValueOnce({
        id: "exp-2",
        locales: [
          {
            id: "loc-2",
            experienceId: "exp-2",
            locale: "en",
            slug: "my-page",
            isHomepage: false,
            pathSegment: null,
            title: null,
            metaDescription: null,
            ogTitle: null,
            ogDescription: null,
            ogImageUrl: null,
            blocks: [],
            status: "DRAFT",
            publishedAt: null,
          },
        ],
      })

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
  // duplicate
  // ---------------------------------------------------------------------------

  describe("duplicate", () => {
    it("copies every locale into a caller-owned unpublished draft", async () => {
      prisma.experience.findFirst.mockResolvedValueOnce({
        id: "exp-source",
        isTemplate: true,
        ownerId: "another-editor",
        archivedAt: null,
        locales: [
          {
            id: "loc-en",
            locale: "en",
            slug: "hope",
            isHomepage: true,
            pathSegment: "topics",
            title: "Hope",
            metaDescription: "Hope meta",
            ogTitle: "Hope OG",
            ogDescription: "Hope OG description",
            ogImageUrl: "https://example.com/hope.jpg",
            blocks: [{ t: "text", heading: "Hope" }],
            status: "PUBLISHED",
            publishedAt: new Date("2026-08-20T12:00:00.000Z"),
          },
          {
            id: "loc-fr",
            locale: "fr",
            slug: "espoir",
            isHomepage: false,
            pathSegment: null,
            title: "Espoir",
            metaDescription: null,
            ogTitle: null,
            ogDescription: null,
            ogImageUrl: null,
            blocks: [],
            status: "DRAFT",
            publishedAt: null,
          },
        ],
      })
      prisma.experienceLocale.findMany.mockResolvedValueOnce([
        { locale: "en", slug: "hope-copy" },
      ])
      prisma.experience.create.mockResolvedValueOnce({
        id: "exp-copy",
        isTemplate: false,
        ownerId: "alice",
        locales: [],
      })

      await service.duplicate({
        input: { id: "exp-source" },
        user: EDITOR_ALICE,
      })

      expect(prisma.experience.create).toHaveBeenCalledWith({
        data: {
          isTemplate: true,
          ownerId: "alice",
          locales: {
            create: [
              expect.objectContaining({
                locale: "en",
                slug: "hope-copy-2",
                isHomepage: false,
                pathSegment: "topics",
                title: "Hope",
                metaDescription: "Hope meta",
                ogTitle: "Hope OG",
                ogDescription: "Hope OG description",
                ogImageUrl: "https://example.com/hope.jpg",
                blocks: [{ t: "text", heading: "Hope" }],
                status: "DRAFT",
                publishedAt: null,
              }),
              expect.objectContaining({
                locale: "fr",
                slug: "espoir-copy",
                isHomepage: false,
                title: "Espoir",
                status: "DRAFT",
                publishedAt: null,
              }),
            ],
          },
        },
        include: { locales: true },
      })
      expect(prisma.contentRevision.create).not.toHaveBeenCalled()
      expect(refreshWatchRouteManifest).not.toHaveBeenCalled()
      expect(after).not.toHaveBeenCalled()
    })

    it("validates blocks without adding schema defaults to the copy", async () => {
      const authoredBlocks = [
        { t: "bibleQuotesCarousel", heading: "Promises of hope" },
      ]
      prisma.experience.findFirst.mockResolvedValueOnce({
        id: "exp-source",
        isTemplate: false,
        archivedAt: null,
        locales: [
          {
            locale: "en",
            slug: "hope",
            isHomepage: false,
            pathSegment: null,
            title: "Hope",
            metaDescription: null,
            ogTitle: null,
            ogDescription: null,
            ogImageUrl: null,
            blocks: authoredBlocks,
          },
        ],
      })
      prisma.experienceLocale.findMany.mockResolvedValueOnce([])
      prisma.experience.create.mockResolvedValueOnce({
        id: "exp-copy",
        locales: [],
      })

      await service.duplicate({ input: { id: "exp-source" }, user: ADMIN })

      const createInput = prisma.experience.create.mock.calls[0][0]
      expect(createInput.data.locales.create[0].blocks).toEqual(authoredBlocks)
      expect(createInput.data.locales.create[0].blocks[0]).not.toHaveProperty(
        "quotes",
      )
    })

    it("copies each locale's active saved draft without copying revision history", async () => {
      prisma.experience.findFirst.mockResolvedValueOnce({
        id: "exp-source",
        isTemplate: false,
        archivedAt: null,
        locales: [
          {
            id: "loc-en",
            experienceId: "exp-source",
            locale: "en",
            slug: "canonical-hope",
            isHomepage: true,
            pathSegment: null,
            title: "Canonical hope",
            metaDescription: null,
            ogTitle: null,
            ogDescription: null,
            ogImageUrl: null,
            blocks: [],
            status: "PUBLISHED",
            publishedAt: new Date("2026-08-20T12:00:00.000Z"),
          },
        ],
      })
      prisma.contentRevision.findMany.mockResolvedValueOnce([
        {
          entityId: "loc-en",
          snapshot: {
            v: 1,
            data: {
              slug: "saved-draft-hope",
              isHomepage: true,
              pathSegment: "topics",
              title: "Saved draft hope",
              metaDescription: "Saved draft meta",
              ogTitle: "Saved draft OG",
              ogDescription: "Saved draft OG description",
              ogImageUrl: "https://example.com/saved-draft.jpg",
              blocks: [{ t: "text", heading: "Saved draft" }],
            },
          },
        },
      ])
      prisma.experienceLocale.findMany.mockResolvedValueOnce([])
      prisma.experience.create.mockResolvedValueOnce({
        id: "exp-copy",
        locales: [],
      })

      await service.duplicate({ input: { id: "exp-source" }, user: ADMIN })

      expect(prisma.experience.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            locales: {
              create: [
                expect.objectContaining({
                  slug: "saved-draft-hope-copy",
                  title: "Saved draft hope",
                  metaDescription: "Saved draft meta",
                  ogTitle: "Saved draft OG",
                  ogDescription: "Saved draft OG description",
                  ogImageUrl: "https://example.com/saved-draft.jpg",
                  pathSegment: "topics",
                  blocks: [{ t: "text", heading: "Saved draft" }],
                  isHomepage: false,
                  status: "DRAFT",
                  publishedAt: null,
                }),
              ],
            },
          }),
        }),
      )
      expect(prisma.contentRevision.create).not.toHaveBeenCalled()
    })

    it("allows an ADMIN to duplicate an archived Experience", async () => {
      prisma.experience.findFirst.mockResolvedValueOnce({
        id: "exp-archived",
        isTemplate: false,
        ownerId: "someone-else",
        archivedAt: new Date("2026-08-01T00:00:00.000Z"),
        locales: [
          {
            id: "loc-en",
            locale: "en",
            slug: "archived",
            isHomepage: false,
            pathSegment: null,
            title: "Archived",
            metaDescription: null,
            ogTitle: null,
            ogDescription: null,
            ogImageUrl: null,
            blocks: [],
            status: "ARCHIVED",
            publishedAt: null,
          },
        ],
      })
      prisma.experienceLocale.findMany.mockResolvedValueOnce([])
      prisma.experience.create.mockResolvedValueOnce({
        id: "exp-copy",
        locales: [{ id: "loc-copy" }],
      })

      await expect(
        service.duplicate({ input: { id: "exp-archived" }, user: ADMIN }),
      ).resolves.toMatchObject({ id: "exp-copy" })
    })

    it("rejects callers without create permission before reading the source", async () => {
      await expect(
        service.duplicate({ input: { id: "exp-source" }, user: VIEWER }),
      ).rejects.toThrow("Forbidden")
      expect(prisma.experience.findFirst).not.toHaveBeenCalled()
    })

    it("reports a missing source Experience", async () => {
      prisma.experience.findFirst.mockResolvedValueOnce(null)

      await expect(
        service.duplicate({ input: { id: "missing" }, user: ADMIN }),
      ).rejects.toThrow("Experience not found: missing")
    })

    it("rejects a zero-locale source before probing slugs or creating", async () => {
      prisma.experience.findFirst.mockResolvedValueOnce({
        id: "exp-empty",
        isTemplate: false,
        ownerId: "admin-1",
        archivedAt: null,
        locales: [],
      })

      await expect(
        service.duplicate({ input: { id: "exp-empty" }, user: ADMIN }),
      ).rejects.toThrow("cannot be duplicated")
      expect(prisma.experienceLocale.findMany).not.toHaveBeenCalled()
      expect(prisma.experience.create).not.toHaveBeenCalled()
    })

    it("rejects malformed saved blocks before probing slugs or creating", async () => {
      prisma.experience.findFirst.mockResolvedValueOnce({
        id: "exp-invalid",
        isTemplate: false,
        ownerId: "admin-1",
        archivedAt: null,
        locales: [
          {
            id: "loc-invalid",
            locale: "en",
            slug: "invalid",
            blocks: [{ t: "not-a-real-block" }],
          },
        ],
      })

      await expect(
        service.duplicate({ input: { id: "exp-invalid" }, user: ADMIN }),
      ).rejects.toThrow("cannot be duplicated")
      expect(prisma.experienceLocale.findMany).not.toHaveBeenCalled()
      expect(prisma.experience.create).not.toHaveBeenCalled()
    })

    it("maps a malformed active draft to the safe duplication error", async () => {
      prisma.experience.findFirst.mockResolvedValueOnce({
        id: "exp-invalid-draft",
        isTemplate: false,
        archivedAt: null,
        locales: [
          {
            id: "loc-invalid-draft",
            experienceId: "exp-invalid-draft",
            locale: "en",
            slug: "canonical",
            isHomepage: false,
            pathSegment: null,
            title: "Canonical",
            metaDescription: null,
            ogTitle: null,
            ogDescription: null,
            ogImageUrl: null,
            blocks: [],
            status: "PUBLISHED",
            publishedAt: new Date("2026-08-20T12:00:00.000Z"),
          },
        ],
      })
      prisma.contentRevision.findMany.mockResolvedValueOnce([
        {
          entityId: "loc-invalid-draft",
          snapshot: {
            v: 1,
            data: { blocks: [{ t: "not-a-real-block" }] },
          },
        },
      ])

      await expect(
        service.duplicate({ input: { id: "exp-invalid-draft" }, user: ADMIN }),
      ).rejects.toThrow("cannot be duplicated")
      expect(prisma.experienceLocale.findMany).not.toHaveBeenCalled()
      expect(prisma.experience.create).not.toHaveBeenCalled()
    })

    it("bounds a generated copy slug to 200 characters", async () => {
      const sourceSlug = "x".repeat(200)
      prisma.experience.findFirst.mockResolvedValueOnce({
        id: "exp-long-slug",
        isTemplate: false,
        ownerId: "admin-1",
        archivedAt: null,
        locales: [
          {
            id: "loc-en",
            locale: "en",
            slug: sourceSlug,
            isHomepage: false,
            pathSegment: null,
            title: null,
            metaDescription: null,
            ogTitle: null,
            ogDescription: null,
            ogImageUrl: null,
            blocks: [],
            status: "DRAFT",
            publishedAt: null,
          },
        ],
      })
      prisma.experienceLocale.findMany.mockResolvedValueOnce([])
      prisma.experience.create.mockResolvedValueOnce({
        id: "exp-copy",
        locales: [],
      })

      await service.duplicate({ input: { id: "exp-long-slug" }, user: ADMIN })

      const createInput = prisma.experience.create.mock.calls[0][0]
      const copiedSlug = createInput.data.locales.create[0].slug
      expect(copiedSlug).toHaveLength(200)
      expect(copiedSlug).toMatch(/-copy$/)
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
        isHomepage: false,
        pathSegment: null,
        ogTitle: null,
        ogDescription: null,
        ogImageUrl: null,
        status: "DRAFT",
        publishedAt: null,
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
          blocks: [],
          experienceId: "exp-1",
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
            status: "DRAFT",
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

    it("does not mutate parent template mode from locale input", async () => {
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

      expect(prisma.experience.update).not.toHaveBeenCalled()
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

    it("does not refresh public routes when staging a published locale", async () => {
      const publishedLocale = { ...localeRow, status: "PUBLISHED" }
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(
        publishedLocale,
      )
      prisma.experienceLocale.update.mockResolvedValueOnce({
        ...publishedLocale,
        title: "Published update",
      })

      await service.updateLocale({
        input: { id: "loc-1", title: "Published update" },
        user: EDITOR_ALICE,
      })

      expect(refreshWatchRouteManifest).not.toHaveBeenCalled()
    })

    it("does not request manifest refresh for draft-only locale updates", async () => {
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(localeRow)
      prisma.experienceLocale.update.mockResolvedValueOnce(localeRow)

      await service.updateLocale({
        input: { id: "loc-1", title: "Draft update" },
        user: EDITOR_ALICE,
      })

      expect(refreshWatchRouteManifest).not.toHaveBeenCalled()
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
  // applyChatMutation (experience-AI chat write path)
  // ---------------------------------------------------------------------------

  it("merges partial saves over the active draft and marks linked SEO materialization stale", async () => {
    const locale = {
      id: "loc-merge",
      experienceId: "exp-1",
      locale: "en",
      slug: "canonical",
      isHomepage: false,
      pathSegment: null,
      title: "Live",
      metaDescription: null,
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      blocks: [],
      status: "PUBLISHED",
      publishedAt: new Date(),
      experience: { ownerId: "alice", archivedAt: null, isTemplate: false },
    }
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(locale)
    prisma.contentRevision.findFirst.mockResolvedValueOnce({
      id: "draft-1",
      previewToken: null,
      snapshot: {
        v: 1,
        data: {
          slug: "staged-slug",
          isHomepage: false,
          pathSegment: null,
          title: "Staged title",
          metaDescription: null,
          ogTitle: null,
          ogDescription: null,
          ogImageUrl: null,
          blocks: [],
        },
      },
    })

    await service.updateLocale({
      input: { id: "loc-merge", metaDescription: "New meta" },
      user: EDITOR_ALICE,
    })

    expect(prisma.contentRevision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "draft-1" },
        data: expect.objectContaining({
          previewToken: expect.any(String),
          snapshot: expect.objectContaining({
            data: expect.objectContaining({
              slug: "staged-slug",
              title: "Staged title",
              metaDescription: "New meta",
            }),
          }),
        }),
      }),
    )
    expect(prisma.seoProposalMaterialization.updateMany).toHaveBeenCalledWith({
      where: { contentRevisionId: "draft-1", status: { not: "STALE" } },
      data: { status: "STALE" },
    })
    expect(prisma.experienceLocale.update).not.toHaveBeenCalled()
  })

  it("serializes concurrent saves and merges the preceding committed draft", async () => {
    const canonical = {
      id: "loc-concurrent",
      experienceId: "exp-1",
      locale: "en",
      slug: "live",
      isHomepage: false,
      pathSegment: null,
      title: "Live",
      metaDescription: null,
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      blocks: [],
      status: "PUBLISHED",
      publishedAt: new Date(),
      experience: { ownerId: "alice", archivedAt: null, isTemplate: false },
    }
    let draft: {
      id: string
      previewToken: string
      snapshot: { v: number; data: Record<string, unknown> }
      [key: string]: unknown
    } = {
      id: "shared-draft",
      previewToken: "stable-token",
      snapshot: {
        v: 1,
        data: {
          slug: "live",
          isHomepage: false,
          pathSegment: null,
          title: "Initial draft",
          metaDescription: null,
          ogTitle: null,
          ogDescription: null,
          ogImageUrl: null,
          blocks: [],
        },
      },
    }
    const isolationLevels: unknown[] = []
    let transactionTail = Promise.resolve()
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      experienceLocale: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(canonical),
      },
      contentRevision: {
        findFirst: vi.fn(async () => ({ ...draft })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          draft = {
            ...draft,
            ...data,
            previewToken:
              typeof data.previewToken === "string"
                ? data.previewToken
                : draft.previewToken,
            snapshot:
              (data.snapshot as typeof draft.snapshot | undefined) ??
              draft.snapshot,
          }
          return { ...draft }
        }),
        create: vi.fn(),
      },
      seoProposalMaterialization: { updateMany: vi.fn() },
    }
    const concurrencyPrisma = {
      experienceLocale: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(canonical),
      },
      $transaction: vi.fn(
        (
          fn: (transaction: typeof tx) => Promise<unknown>,
          options?: { isolationLevel?: unknown },
        ) => {
          isolationLevels.push(options?.isolationLevel)
          const result = transactionTail.then(() => fn(tx))
          transactionTail = result.then(
            () => undefined,
            () => undefined,
          )
          return result
        },
      ),
    }
    // This purpose-built client models the database row lock by queueing the
    // transaction callbacks while retaining the committed revision state.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const concurrentService = new ExperienceService(concurrencyPrisma as any)

    await Promise.all([
      concurrentService.updateLocale({
        input: { id: canonical.id, title: "First save" },
        user: EDITOR_ALICE,
      }),
      concurrentService.updateLocale({
        input: { id: canonical.id, metaDescription: "Second save" },
        user: EDITOR_ALICE,
      }),
    ])

    expect(draft.snapshot).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "First save",
          metaDescription: "Second save",
        }),
      }),
    )
    expect(isolationLevels).toEqual(["ReadCommitted", "ReadCommitted"])
  })

  describe("applyChatMutation", () => {
    const baseRow = {
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

    // Full-precision (microsecond) updated_at text — the value Postgres
    // returns from `updated_at::text` for a bare TIMESTAMPTZ column. The
    // guard must compare this verbatim, never a millisecond-truncated Date.
    const MICRO_TS = "2026-04-15 12:00:00.336275+00"

    it("creates a HISTORICAL contentRevision + updates the locale in one $transaction (happy path)", async () => {
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(baseRow) // pre-image read
      // Baseline read, then the FOR UPDATE locked read — same full-precision
      // text, so the optimistic guard passes.
      prisma.$queryRaw
        .mockResolvedValueOnce([{ u: MICRO_TS }])
        .mockResolvedValueOnce([{ u: MICRO_TS }])
      prisma.experienceLocale.update.mockResolvedValueOnce({
        ...baseRow,
        title: "Chat Title",
      })

      const result = await service.applyChatMutation({
        input: { id: "loc-1", title: "Chat Title" },
        user: EDITOR_ALICE,
        reason: "Chat-driven mutation",
      })

      expect(result.after.title).toBe("Chat Title")
      // Revision is the shared AI-stamped DRAFT snapshot.
      expect(prisma.contentRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: "ExperienceLocale",
            entityId: "loc-1",
            status: "DRAFT",
            revisedByKind: "AI",
          }),
        }),
      )
      expect(prisma.experienceLocale.update).not.toHaveBeenCalled()
      expect(prisma.experienceLocale.updateMany).not.toHaveBeenCalled()
    })

    it("throws ForbiddenError when the principal cannot edit the locale", async () => {
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(baseRow)

      await expect(
        service.applyChatMutation({
          input: { id: "loc-1", title: "Hijack" },
          user: EDITOR_BOB,
          reason: "Chat-driven mutation",
        }),
      ).rejects.toThrow("Forbidden")
      // No write attempted on a forbidden mutation.
      expect(prisma.experienceLocale.update).not.toHaveBeenCalled()
    })

    it("strips slug from the update payload (slug is not chat-writable)", async () => {
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(baseRow)
      prisma.$queryRaw
        .mockResolvedValueOnce([{ u: MICRO_TS }])
        .mockResolvedValueOnce([{ u: MICRO_TS }])
      prisma.experienceLocale.update.mockResolvedValueOnce(baseRow)

      await service.applyChatMutation({
        // `slug` is not on ChatMutationInput; the Zod parse must strip it
        // so it never reaches the update payload.
        input: { id: "loc-1", title: "Keep slug", slug: "evil-slug" } as never,
        user: EDITOR_ALICE,
        reason: "Chat-driven mutation",
      })

      const call = prisma.contentRevision.create.mock.calls[0][0] as {
        data: { snapshot: { data: Record<string, unknown> } }
      }
      expect(call.data.snapshot.data).toHaveProperty("slug", "test-locale")
      expect(call.data.snapshot.data).toHaveProperty("title", "Keep slug")
    })

    it("uses last-save-wins instead of rejecting a stale chat baseline", async () => {
      // Pre-image read succeeds, but the FOR UPDATE locked read returns a
      // DIFFERENT full-precision updated_at than the baseline → a concurrent
      // writer changed the row → lost-update guard fires. (Crucially, this
      // is a real text difference, NOT the old millisecond-truncation false
      // positive that fired on every microsecond-stamped row.)
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(baseRow)
      prisma.$queryRaw
        .mockResolvedValueOnce([{ u: MICRO_TS }]) // baseline
        .mockResolvedValueOnce([{ u: "2026-04-15 12:00:05.111222+00" }]) // locked (changed)

      const result = await service.applyChatMutation({
        input: { id: "loc-1", title: "Stale write" },
        user: EDITOR_ALICE,
        reason: "Chat-driven mutation",
      })

      expect(result.after.title).toBe("Stale write")
      expect(prisma.contentRevision.create).toHaveBeenCalled()
      expect(prisma.experienceLocale.update).not.toHaveBeenCalled()
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
      expect(prisma.contentRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: "ExperienceLocale",
            entityId: "loc-1",
            status: "HISTORICAL",
          }),
        }),
      )
      expect(refreshWatchRouteManifest).toHaveBeenCalledWith({
        prisma,
        reason: "experience.publish",
      })
    })

    it("schedules the manifest refresh through after() so it survives the response", async () => {
      const localeRow = {
        id: "loc-1",
        experienceId: "exp-1",
        locale: "en",
        slug: "publish-after",
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

      await service.publishLocale({
        input: { id: "loc-1" },
        user: EDITOR_ALICE,
      })

      // The refresh is handed to after() rather than left as a bare detached
      // promise — that is what keeps it alive past a standalone Server Action
      // response so newly published slugs reach the persisted snapshot.
      expect(after).toHaveBeenCalledTimes(1)
      const scheduled = vi.mocked(after).mock.calls[0]?.[0] as () => unknown
      expect(typeof scheduled).toBe("function")
      // Invoking the scheduled task resolves to the refresh outcome and never
      // throws (refreshWatchRouteManifest returns a typed outcome).
      await expect(Promise.resolve(scheduled())).resolves.toEqual({
        status: "refreshed",
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
  // discardLocaleDraft
  // ---------------------------------------------------------------------------

  describe("discardLocaleDraft", () => {
    const locale = {
      id: "loc-discard",
      experienceId: "exp-1",
      locale: "en",
      slug: "live",
      isHomepage: false,
      pathSegment: null,
      title: "Live",
      metaDescription: null,
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      blocks: [],
      status: "PUBLISHED",
      publishedAt: new Date(),
      experience: { ownerId: "alice", archivedAt: null },
    }

    it("retires an active draft without changing canonical content", async () => {
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(locale)
      prisma.contentRevision.findFirst.mockResolvedValueOnce({ id: "draft-1" })

      const result = await service.discardLocaleDraft({
        input: { id: "loc-discard" },
        user: EDITOR_ALICE,
      })

      expect(result).toEqual(locale)
      expect(prisma.contentRevision.update).toHaveBeenCalledWith({
        where: { id: "draft-1" },
        data: { status: "DISCARDED" },
      })
      expect(prisma.seoProposalMaterialization.updateMany).toHaveBeenCalledWith(
        {
          where: {
            contentRevisionId: "draft-1",
            status: { not: "STALE" },
          },
          data: { status: "STALE" },
        },
      )
      expect(prisma.experienceLocale.update).not.toHaveBeenCalled()
      expect(refreshWatchRouteManifest).not.toHaveBeenCalled()
    })

    it("is idempotent when there is no active draft", async () => {
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(locale)
      prisma.contentRevision.findFirst.mockResolvedValueOnce(null)

      await expect(
        service.discardLocaleDraft({
          input: { id: "loc-discard" },
          user: EDITOR_ALICE,
        }),
      ).resolves.toEqual(locale)
      expect(prisma.contentRevision.update).not.toHaveBeenCalled()
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
      expect(prisma.contentRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityId: "loc-1",
            status: "DRAFT",
            snapshot: expect.objectContaining({
              data: expect.objectContaining({
                slug: "restored-slug",
                title: "Restored title",
                pathSegment: "restored",
                isHomepage: true,
              }),
            }),
          }),
        }),
      )
      expect(prisma.experienceLocale.update).not.toHaveBeenCalled()
      expect(refreshWatchRouteManifest).not.toHaveBeenCalled()
    })

    it("does not refresh the public manifest when restoring an already-draft locale", async () => {
      prisma.contentRevision.findUniqueOrThrow.mockResolvedValueOnce(
        revisionRow,
      )
      prisma.contentRevision.update.mockResolvedValueOnce({
        ...revisionRow,
        appliedAt: new Date("2026-04-15T12:30:00.000Z"),
      })
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce({
        ...localeRow,
        status: "DRAFT",
      })
      prisma.experienceLocale.update.mockResolvedValueOnce({
        ...localeRow,
        status: "DRAFT",
      })

      await service.restoreLocaleRevision({
        input: { revisionId: "rev-1" },
        user: EDITOR_ALICE,
      })

      expect(refreshWatchRouteManifest).not.toHaveBeenCalled()
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
      expect(refreshWatchRouteManifest).toHaveBeenCalledWith({
        prisma,
        reason: "experience.archive",
      })
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
      // R9: PUBLIC gets archivedAt + isTemplate filters together.
      expect(call.where.experience).toEqual({
        archivedAt: null,
        isTemplate: false,
      })
    })

    it("VIEWER sees published only — templates remain visible", async () => {
      prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)

      await service.getBySlug({
        locale: "en",
        slug: "test",
        user: VIEWER,
        query: {},
      })

      const call = prisma.experienceLocale.findFirst.mock.calls[0][0]
      expect(call.where).toHaveProperty("status", "PUBLISHED")
      // R9 is narrowly scoped: VIEWER (editorial-tier read-only) keeps
      // template visibility; only PUBLIC + CONSUMER_BEARER lose it.
      expect(call.where.experience).toEqual({ archivedAt: null })
      expect(call.where.experience).not.toHaveProperty("isTemplate")
    })
  })

  // ---------------------------------------------------------------------------
  // getBySlug — R9 template-filter (PUBLIC + CONSUMER_BEARER)
  // ---------------------------------------------------------------------------

  describe("getBySlug — R9 template filter", () => {
    it("PUBLIC where clause includes isTemplate: false", async () => {
      prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)

      await service.getBySlug({
        locale: "en",
        slug: "any",
        user: PUBLIC_USER,
        query: {},
      })

      const call = prisma.experienceLocale.findFirst.mock.calls[0][0]
      expect(call.where.experience).toMatchObject({ isTemplate: false })
    })

    it("CONSUMER_BEARER where clause includes isTemplate: false", async () => {
      prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)

      await service.getBySlug({
        locale: "en",
        slug: "any",
        user: CONSUMER_BEARER_USER,
        query: {},
      })

      const call = prisma.experienceLocale.findFirst.mock.calls[0][0]
      expect(call.where).toHaveProperty("status", "PUBLISHED")
      expect(call.where.experience).toMatchObject({
        archivedAt: null,
        isTemplate: false,
      })
    })

    it("VIEWER where clause does NOT include isTemplate (templates still visible)", async () => {
      prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)

      await service.getBySlug({
        locale: "en",
        slug: "any",
        user: VIEWER,
        query: {},
      })

      const call = prisma.experienceLocale.findFirst.mock.calls[0][0]
      expect(call.where.experience).not.toHaveProperty("isTemplate")
    })

    it("EDITOR where clause does NOT include isTemplate (no consumer-tier filters apply)", async () => {
      prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)

      await service.getBySlug({
        locale: "en",
        slug: "any",
        user: EDITOR_ALICE,
        query: {},
      })

      const call = prisma.experienceLocale.findFirst.mock.calls[0][0]
      expect(call.where).not.toHaveProperty("status")
      expect(call.where).not.toHaveProperty("experience")
    })

    it("ADMIN where clause does NOT include isTemplate", async () => {
      prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)

      await service.getBySlug({
        locale: "en",
        slug: "any",
        user: ADMIN,
        query: {},
      })

      const call = prisma.experienceLocale.findFirst.mock.calls[0][0]
      expect(call.where).not.toHaveProperty("status")
      expect(call.where).not.toHaveProperty("experience")
    })
  })
})
