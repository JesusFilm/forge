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
  const findDefaultTemplate = vi.fn()
  const service = new ExperiencePreviewService({
    contentRevision: { findUnique },
    experienceLocale: { findFirst },
    experience: { findFirst: findDefaultTemplate },
  } as unknown as PrismaClient)

  beforeEach(() => {
    vi.clearAllMocks()
    findDefaultTemplate.mockReset().mockResolvedValue(null)
  })

  it("returns the validated draft snapshot and canonical identity", async () => {
    findUnique.mockResolvedValue(draftRevision())
    findFirst.mockResolvedValue({
      id: "locale-1",
      experienceId: "experience-1",
      locale: "en",
      experience: { isTemplate: false },
    })

    await expect(service.resolveByToken({ token: TOKEN })).resolves.toEqual({
      experienceId: "experience-1",
      localeId: "locale-1",
      locale: "en",
      isTemplate: false,
      isDefaultTemplate: false,
      slug: "home-draft",
      isHomepage: true,
      // Written before the field existed, so the schema default applies.
      homepageLayout: false,
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

  // Keep the generic parent flag independent of selected Watch ownership.
  it.each([true, false])(
    "carries the parent Experience template flag (%s) into the preview",
    async (isTemplate) => {
      findUnique.mockResolvedValue(draftRevision())
      findFirst.mockResolvedValue({
        id: "locale-1",
        experienceId: "experience-1",
        locale: "en",
        experience: { isTemplate },
      })

      await expect(
        service.resolveByToken({ token: TOKEN }),
      ).resolves.toMatchObject({ isTemplate })
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            experience: { select: { isTemplate: true } },
          }),
        }),
      )
    },
  )

  it.each([
    ["selected A", "template-a", "template-a", true, true],
    ["non-default B", "template-b", "template-a", true, false],
    ["no selected parent", "template-b", null, true, false],
    ["ordinary parent", "ordinary", "template-a", false, false],
  ] as const)(
    "derives Watch identity independently for %s",
    async (_label, experienceId, selectedId, isTemplate, isDefaultTemplate) => {
      const revision = draftRevision()
      findUnique.mockResolvedValue({
        ...revision,
        snapshot: {
          ...revision.snapshot,
          data: {
            ...revision.snapshot.data,
            // Untrusted snapshot fields cannot grant selected-parent authority.
            isTemplate: true,
            isDefaultTemplate: true,
          },
        },
      })
      findFirst.mockResolvedValue({
        id: "locale-1",
        experienceId,
        locale: "en",
        experience: { isTemplate },
      })
      findDefaultTemplate.mockResolvedValue(
        selectedId ? { id: selectedId } : null,
      )

      await expect(
        service.resolveByToken({ token: TOKEN }),
      ).resolves.toMatchObject({ experienceId, isTemplate, isDefaultTemplate })
      if (isTemplate) expect(findDefaultTemplate).toHaveBeenCalledOnce()
      else expect(findDefaultTemplate).not.toHaveBeenCalled()
    },
  )

  it("carries the homepage layout of an unassigned homepage copy", async () => {
    const base = draftRevision()
    findUnique.mockResolvedValue({
      ...base,
      snapshot: {
        v: 1,
        data: {
          ...base.snapshot.data,
          isHomepage: false,
          homepageLayout: true,
        },
      },
    })
    findFirst.mockResolvedValue({
      id: "locale-1",
      experienceId: "experience-1",
      locale: "en",
      experience: { isTemplate: false },
    })

    await expect(
      service.resolveByToken({ token: TOKEN }),
    ).resolves.toMatchObject({ isHomepage: false, homepageLayout: true })
  })

  it("rejects malformed tokens without touching persistence", async () => {
    await expect(
      service.resolveByToken({ token: "not-a-capability" }),
    ).resolves.toBeNull()
    expect(findUnique).not.toHaveBeenCalled()
    expect(findDefaultTemplate).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", null],
    ["published", draftRevision({ status: "HISTORICAL" })],
    ["foreign entity", draftRevision({ entityType: "VideoLocale" })],
  ])("returns null for a %s revision", async (_label, revision) => {
    findUnique.mockResolvedValue(revision)

    await expect(service.resolveByToken({ token: TOKEN })).resolves.toBeNull()
    expect(findFirst).not.toHaveBeenCalled()
    expect(findDefaultTemplate).not.toHaveBeenCalled()
  })

  it("returns null for an invalid snapshot", async () => {
    findUnique.mockResolvedValue(draftRevision({ snapshot: { v: 1 } }))

    await expect(service.resolveByToken({ token: TOKEN })).resolves.toBeNull()
    expect(findFirst).not.toHaveBeenCalled()
    expect(findDefaultTemplate).not.toHaveBeenCalled()
  })

  it("returns null when the locale is missing or its parent is archived", async () => {
    findUnique.mockResolvedValue(draftRevision())
    findFirst.mockResolvedValue(null)

    await expect(service.resolveByToken({ token: TOKEN })).resolves.toBeNull()
    expect(findDefaultTemplate).not.toHaveBeenCalled()
  })
})
