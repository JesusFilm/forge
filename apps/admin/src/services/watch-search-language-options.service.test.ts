import { beforeEach, describe, expect, it, vi } from "vitest"

const findMany = vi.fn()
const findFirst = vi.fn()

vi.mock("@/db/client", () => ({
  prisma: { language: { findMany, findFirst } },
}))

const { loadWatchSearchLanguageOptions, resolveWatchSearchLanguageSelection } =
  await import("./watch-search-language-options.service")

describe("loadWatchSearchLanguageOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findFirst.mockImplementation(
      async ({ where }: { where: { slug: string } }) =>
        where.slug === "balanta-kentohe"
          ? { slug: "balanta-kentohe", bcp47: "ble-x-Naga" }
          : null,
    )
  })

  it("returns active canonical languages as friendly combined options", async () => {
    findMany.mockResolvedValue([
      {
        name: { en: "Russian" },
        bcp47: "ru",
        slug: "russian",
        locales: [],
      },
      {
        name: { en: "Legacy Japanese name" },
        bcp47: "ja-JP",
        slug: "japanese",
        locales: [{ value: "Japanese" }],
      },
      {
        name: { es: " Español " },
        bcp47: "es",
        slug: "spanish",
        locales: [],
      },
      {
        name: { en: "Balanta-Kentohe" },
        bcp47: "ble-x-Naga",
        slug: "balanta-kentohe",
        locales: [],
      },
    ])

    await expect(loadWatchSearchLanguageOptions()).resolves.toEqual([
      { label: "Balanta-Kentohe — ble-x-Naga", value: "balanta-kentohe" },
      { label: "Español — es", value: "spanish" },
      { label: "Japanese — ja-JP", value: "japanese" },
      { label: "Russian — ru", value: "russian" },
    ])
    await expect(
      resolveWatchSearchLanguageSelection("balanta-kentohe"),
    ).resolves.toEqual({
      targetLanguageSlug: "balanta-kentohe",
      locale: "ble-x-Naga",
    })
    await expect(
      resolveWatchSearchLanguageSelection("missing"),
    ).resolves.toBeNull()
    expect(findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        bcp47: { not: null },
        slug: { not: null },
      },
      select: {
        bcp47: true,
        slug: true,
        name: true,
        locales: {
          where: { deletedAt: null, locale: "en" },
          select: { value: true },
          take: 1,
        },
      },
    })
    expect(findMany).toHaveBeenCalledOnce()
    expect(findFirst).toHaveBeenCalledTimes(2)
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        slug: "balanta-kentohe",
        deletedAt: null,
        bcp47: { not: null },
      },
      select: {
        slug: true,
        bcp47: true,
      },
    })
  })
})
