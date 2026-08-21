import type { PrismaClient } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ExperiencePreviewService } from "./experience-preview.service"

const TOKEN = "a".repeat(43)

function draftRevision(overrides: Record<string, unknown> = {}) {
  return {
    entityType: "ExperienceLocale",
    entityId: "locale-1",
    status: "DRAFT",
    snapshot: {
      v: 1,
      data: {
        slug: "home-draft",
        isHomepage: true,
        pathSegment: null,
        title: "Draft home",
        metaDescription: "Draft description",
        ogTitle: null,
        ogDescription: null,
        ogImageUrl: null,
        blocks: [],
      },
    },
    ...overrides,
  }
}

describe("ExperiencePreviewService", () => {
  const findUnique = vi.fn()
  const findFirst = vi.fn()
  const service = new ExperiencePreviewService({
    contentRevision: { findUnique },
    experienceLocale: { findFirst },
  } as unknown as PrismaClient)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns the validated draft snapshot and canonical identity", async () => {
    findUnique.mockResolvedValue(draftRevision())
    findFirst.mockResolvedValue({
      id: "locale-1",
      experienceId: "experience-1",
      locale: "en",
    })

    await expect(service.resolveByToken({ token: TOKEN })).resolves.toEqual({
      experienceId: "experience-1",
      localeId: "locale-1",
      locale: "en",
      slug: "home-draft",
      isHomepage: true,
      pathSegment: null,
      title: "Draft home",
      metaDescription: "Draft description",
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      blocks: [],
    })
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { previewToken: TOKEN } }),
    )
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "locale-1",
          experience: { archivedAt: null },
        },
      }),
    )
  })

  it("rejects malformed tokens without touching persistence", async () => {
    await expect(
      service.resolveByToken({ token: "not-a-capability" }),
    ).resolves.toBeNull()
    expect(findUnique).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", null],
    ["published", draftRevision({ status: "HISTORICAL" })],
    ["foreign entity", draftRevision({ entityType: "VideoLocale" })],
  ])("returns null for a %s revision", async (_label, revision) => {
    findUnique.mockResolvedValue(revision)

    await expect(service.resolveByToken({ token: TOKEN })).resolves.toBeNull()
    expect(findFirst).not.toHaveBeenCalled()
  })

  it("returns null for an invalid snapshot", async () => {
    findUnique.mockResolvedValue(draftRevision({ snapshot: { v: 1 } }))

    await expect(service.resolveByToken({ token: TOKEN })).resolves.toBeNull()
    expect(findFirst).not.toHaveBeenCalled()
  })

  it("returns null when the locale is missing or its parent is archived", async () => {
    findUnique.mockResolvedValue(draftRevision())
    findFirst.mockResolvedValue(null)

    await expect(service.resolveByToken({ token: TOKEN })).resolves.toBeNull()
  })
})
