import { beforeEach, describe, expect, it, vi } from "vitest"
import { WatchSettingService } from "./watch-setting.service"

function mockPrisma() {
  return {
    experienceLocale: {
      findMany: vi.fn(),
    },
    experience: {
      findFirst: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe("WatchSettingService.get", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: WatchSettingService

  beforeEach(() => {
    prisma = mockPrisma()
    service = new WatchSettingService(prisma)
    vi.restoreAllMocks()
  })

  it("returns homepage + template + parent documentId for a populated locale", async () => {
    const homepage = {
      id: "loc-home-1",
      experienceId: "exp-home-1",
      locale: "en",
    }
    const templateLocale = {
      id: "loc-tmpl-1",
      experienceId: "exp-tmpl-1",
      locale: "en",
    }
    prisma.experienceLocale.findMany.mockResolvedValueOnce([homepage])
    prisma.experience.findFirst.mockResolvedValueOnce({
      id: "exp-tmpl-1",
      locales: [templateLocale],
    })

    const result = await service.get({ locale: "en" })

    expect(result).toEqual({
      documentId: "exp-home-1",
      homepageExperience: homepage,
      defaultTemplateExperience: templateLocale,
    })
  })

  it("service-layer ABAC discipline: homepage query gates on status=PUBLISHED + non-archived parent", async () => {
    prisma.experienceLocale.findMany.mockResolvedValueOnce([])
    prisma.experience.findFirst.mockResolvedValueOnce(null)

    await service.get({ locale: "en" })

    const homepageCall = prisma.experienceLocale.findMany.mock.calls[0][0]
    expect(homepageCall.where).toMatchObject({
      isHomepage: true,
      locale: "en",
      status: "PUBLISHED",
      experience: { archivedAt: null },
    })
  })

  it("service-layer ABAC discipline: template query gates on isTemplate + non-archived + per-locale PUBLISHED", async () => {
    prisma.experienceLocale.findMany.mockResolvedValueOnce([])
    prisma.experience.findFirst.mockResolvedValueOnce(null)

    await service.get({ locale: "en" })

    const templateCall = prisma.experience.findFirst.mock.calls[0][0]
    expect(templateCall.where).toMatchObject({
      isTemplate: true,
      archivedAt: null,
    })
    expect(templateCall.include.locales.where).toMatchObject({
      locale: "en",
      status: "PUBLISHED",
    })
  })

  it("returns null homepage when no ExperienceLocale row matches the locale", async () => {
    prisma.experienceLocale.findMany.mockResolvedValueOnce([])
    prisma.experience.findFirst.mockResolvedValueOnce(null)

    const result = await service.get({ locale: "de" })

    expect(result.homepageExperience).toBeNull()
    expect(result.defaultTemplateExperience).toBeNull()
    expect(result.documentId).toBeNull()
  })

  it("returns null template when isTemplate Experience has no PUBLISHED locale for the requested locale", async () => {
    prisma.experienceLocale.findMany.mockResolvedValueOnce([])
    prisma.experience.findFirst.mockResolvedValueOnce({
      id: "exp-tmpl-1",
      locales: [], // no published locale for this language
    })

    const result = await service.get({ locale: "de" })

    expect(result.defaultTemplateExperience).toBeNull()
  })

  it("strict-null locale fallback: missing homepage returns null, not a fallback locale", async () => {
    // Mirrors Strapi v5 singleType+i18n default behavior.
    prisma.experienceLocale.findMany.mockResolvedValueOnce([])
    prisma.experience.findFirst.mockResolvedValueOnce(null)

    const result = await service.get({ locale: "de" })

    expect(result.homepageExperience).toBeNull()
  })

  it("multi-row tiebreak: when two locales share isHomepage=true for the same locale, picks updatedAt desc and logs a warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const newer = { id: "loc-1", experienceId: "exp-1", locale: "en" }
    const older = { id: "loc-2", experienceId: "exp-2", locale: "en" }
    prisma.experienceLocale.findMany.mockResolvedValueOnce([newer, older])
    prisma.experience.findFirst.mockResolvedValueOnce(null)

    const result = await service.get({ locale: "en" })

    expect(result.homepageExperience).toEqual(newer)
    expect(warnSpy).toHaveBeenCalledOnce()
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string)
    expect(logged).toMatchObject({
      event: "watch_setting.homepage.multiple_rows",
      locale: "en",
      count: 2,
      chosen_id: "loc-1",
    })
    expect(prisma.experienceLocale.findMany.mock.calls[0][0].orderBy).toEqual({
      updatedAt: "desc",
    })
  })

  it("falls back to template's parent documentId when homepage is null", async () => {
    const templateLocale = {
      id: "loc-tmpl-1",
      experienceId: "exp-tmpl-1",
      locale: "en",
    }
    prisma.experienceLocale.findMany.mockResolvedValueOnce([])
    prisma.experience.findFirst.mockResolvedValueOnce({
      id: "exp-tmpl-1",
      locales: [templateLocale],
    })

    const result = await service.get({ locale: "en" })

    expect(result.documentId).toBe("exp-tmpl-1")
    expect(result.homepageExperience).toBeNull()
    expect(result.defaultTemplateExperience).toEqual(templateLocale)
  })
})
