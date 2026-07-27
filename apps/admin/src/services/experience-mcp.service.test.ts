import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Principal } from "@/auth/principal"
import { ExperienceMcpService } from "./experience-mcp.service"

vi.mock("@/services/revalidate-webhook", () => ({
  emitRevalidateWebhook: vi.fn(),
}))
vi.mock("@/services/watch-route-manifest-refresh.service", () => ({
  refreshWatchRouteManifest: vi.fn().mockResolvedValue({ ok: true }),
}))

function mockPrisma() {
  return {
    experience: {
      create: vi.fn(),
    },
    experienceLocale: {
      findFirst: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }
const EDITOR_ALICE: Principal = { id: "alice", role: "EDITOR" }
const VIEWER: Principal = { id: "viewer-1", role: "VIEWER" }
const PUBLIC_USER: Principal | null = null

const updatedAt = new Date("2026-07-27T12:00:00.000Z")

const CREATED_LOCALE = {
  id: "loc-en",
  experienceId: "exp-1",
  locale: "en",
  slug: "hope",
  isHomepage: false,
  pathSegment: null,
  title: "Hope",
  metaDescription: null,
  ogTitle: null,
  ogDescription: null,
  ogImageUrl: null,
  blocks: [{ t: "text", heading: "Hope" }],
  status: "DRAFT",
  publishedAt: null,
  updatedAt,
}

const CREATED_EXPERIENCE = {
  id: "exp-1",
  isTemplate: false,
  ownerId: "admin-1",
  locales: [CREATED_LOCALE],
}

const VALID_INPUT = {
  locale: "en",
  slug: "hope",
  title: "Hope",
  blocks: [{ t: "text", heading: "Hope" }],
}

describe("ExperienceMcpService", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: ExperienceMcpService

  beforeEach(() => {
    prisma = mockPrisma()
    service = new ExperienceMcpService(prisma)
  })

  it("creates a DRAFT Experience through the existing Experience service", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
    prisma.experience.create.mockResolvedValueOnce(CREATED_EXPERIENCE)

    await expect(
      service.createExperience({ input: VALID_INPUT, user: ADMIN }),
    ).resolves.toMatchObject({
      created: true,
      experience: { id: "exp-1", isTemplate: false, ownerId: "admin-1" },
      locale: {
        id: "loc-en",
        experienceId: "exp-1",
        locale: "en",
        slug: "hope",
        status: "DRAFT",
        publishedAt: null,
        updatedAt: "2026-07-27T12:00:00.000Z",
      },
      editorUrl: "http://localhost:3003/dashboard/experiences/exp-1?locale=en",
    })

    expect(prisma.experience.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: "admin-1",
          locales: expect.objectContaining({
            create: expect.objectContaining({
              locale: "en",
              slug: "hope",
              title: "Hope",
            }),
          }),
        }),
        include: { locales: true },
      }),
    )
  })

  it("EDITOR becomes the owner of the created Experience", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
    prisma.experience.create.mockResolvedValueOnce({
      ...CREATED_EXPERIENCE,
      ownerId: "alice",
    })

    await service.createExperience({ input: VALID_INPUT, user: EDITOR_ALICE })

    expect(prisma.experience.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: "alice" }),
      }),
    )
  })

  it("VIEWER cannot create and nothing is persisted", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)

    await expect(
      service.createExperience({ input: VALID_INPUT, user: VIEWER }),
    ).rejects.toThrow("Forbidden")
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("PUBLIC cannot create and nothing is persisted", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)

    await expect(
      service.createExperience({ input: VALID_INPUT, user: PUBLIC_USER }),
    ).rejects.toThrow("Forbidden")
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("rejects blocks that fail the persistence BlocksSchema and persists nothing", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)

    await expect(
      service.createExperience({
        input: {
          ...VALID_INPUT,
          blocks: [{ t: "nonexistent_block_type" }],
        },
        user: ADMIN,
      }),
    ).rejects.toThrow()
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("rejects unknown fields loudly instead of silently dropping them", async () => {
    // CreateExperienceInput STRIPS unknown keys; the tool schema is `.strict()`
    // so a caller passing metaDescription gets an error, not silent data loss.
    await expect(
      service.createExperience({
        input: { ...VALID_INPUT, metaDescription: "would be dropped" },
        user: ADMIN,
      }),
    ).rejects.toThrow()
    expect(prisma.experienceLocale.findFirst).not.toHaveBeenCalled()
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("rejects an empty title", async () => {
    await expect(
      service.createExperience({
        input: { ...VALID_INPUT, title: "" },
        user: ADMIN,
      }),
    ).rejects.toThrow()
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("reports the existing resource on a duplicate (locale, slug) instead of creating a second draft", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce({
      id: "loc-existing",
      experienceId: "exp-existing",
      status: "DRAFT",
    })

    await expect(
      service.createExperience({ input: VALID_INPUT, user: ADMIN }),
    ).resolves.toEqual({
      created: false,
      conflict: {
        reason: "slug_exists",
        locale: "en",
        slug: "hope",
        existingExperienceId: "exp-existing",
        existingLocaleId: "loc-existing",
        existingStatus: "DRAFT",
      },
    })
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("accepts a large non-Latin blocks payload (3-byte script)", async () => {
    // ~17k CJK chars ≈ 51KB of UTF-8 — the whole JSON-RPC envelope stays
    // under the route's 64KB cap while proving byte-heavy scripts validate.
    const cjkParagraph = "あ".repeat(17_000)
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
    prisma.experience.create.mockResolvedValueOnce(CREATED_EXPERIENCE)

    await expect(
      service.createExperience({
        input: {
          ...VALID_INPUT,
          blocks: [{ t: "text", contentParagraphs: [cjkParagraph] }],
        },
        user: ADMIN,
      }),
    ).resolves.toMatchObject({ created: true })

    expect(prisma.experience.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          locales: expect.objectContaining({
            create: expect.objectContaining({
              blocks: [
                expect.objectContaining({
                  contentParagraphs: [cjkParagraph],
                }),
              ],
            }),
          }),
        }),
      }),
    )
  })
})
