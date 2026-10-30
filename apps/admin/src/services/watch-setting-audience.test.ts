import { describe, expect, it, vi } from "vitest"
import { createWatchAudienceConfiguration } from "@forge/experience-schema"
import type { PrismaClient, ExperienceLocale } from "@prisma/client"
import { WatchSettingService } from "./watch-setting.service"
const config = createWatchAudienceConfiguration()
function fixture() {
  const locale = {
    id: "published",
    locale: "fr",
    experienceId: "template",
    blocks: [
      { t: "watchAudience", sectionKey: "audience", configuration: config },
    ],
  } as unknown as ExperienceLocale
  const prisma = {
    experienceLocale: { findMany: vi.fn().mockResolvedValue([]) },
    experience: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: "template", locales: [locale] }),
    },
    contentRevision: {
      findFirst: vi.fn(() => {
        throw new Error("Draft read forbidden")
      }),
    },
  }
  return {
    locale,
    prisma,
    service: new WatchSettingService(prisma as unknown as PrismaClient),
  }
}
describe("WatchSetting shared published audience source", () => {
  it("reuses the exact default-template locale row without draft/homepage queries", async () => {
    const { service, prisma, locale } = fixture()
    const root = await service.get({ locale: "fr" })
    expect(root.defaultTemplateExperience).toBe(locale)
    expect(await service.getWatchAudience(root)).toMatchObject({
      sourceLocale: "fr",
      sourceBlockId: "audience",
      rejected: false,
    })
    expect(prisma.experience.findFirst).toHaveBeenCalledTimes(1)
    expect(prisma.contentRevision.findFirst).not.toHaveBeenCalled()
    expect(prisma.experience.findFirst).toHaveBeenCalledWith({
      where: { isTemplate: true, archivedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        locales: { where: { locale: "fr", status: "PUBLISHED" }, take: 1 },
      },
    })
  })
  it("keeps STRICT NULL locale without a language fallback", async () => {
    const { service, prisma } = fixture()
    prisma.experience.findFirst.mockResolvedValue({
      id: "template",
      locales: [],
    })
    const root = await service.get({ locale: "missing" })
    expect(await service.getWatchAudience(root)).toBeNull()
    expect(prisma.experience.findFirst).toHaveBeenCalledTimes(1)
  })
  it("uses the same template policy for an explicit locale override", async () => {
    const { service, prisma } = fixture()
    const root = await service.get({ locale: "fr" })
    prisma.experience.findFirst.mockResolvedValueOnce({
      id: "template",
      locales: [],
    })
    expect(await service.getWatchAudience(root, "es")).toBeNull()
    expect(
      prisma.experience.findFirst.mock.calls[1]![0].include.locales.where,
    ).toEqual({ locale: "es", status: "PUBLISHED" })
  })
})
