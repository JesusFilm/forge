import { describe, expect, it, vi } from "vitest"

import {
  SearchEvalCatalogContextError,
  readSearchEvalCatalogContext,
} from "./search-eval-catalog-context"

function buildPrisma() {
  return {
    videoLocale: {
      findMany: vi.fn(async () => [
        {
          id: "video-locale-1",
          locale: "en",
          title: " JESUS ",
          description: " A feature film about the life of Jesus. ".repeat(20),
          snippet: "The story of Jesus.",
          video: {
            id: "video-1",
            slug: "jesus",
            label: "FEATURE_FILM",
            keywords: [
              { keyword: { value: "Jesus" } },
              { keyword: { value: "Gospel" } },
            ],
          },
        },
      ]),
    },
    experienceLocale: {
      findMany: vi.fn(async () => [
        {
          id: "experience-locale-1",
          locale: "en",
          slug: "hope",
          title: "Hope",
          metaDescription: "Resources about hope.",
          ogDescription: "Find hope in Jesus.",
          experience: {
            id: "experience-1",
          },
        },
      ]),
    },
  }
}

describe("readSearchEvalCatalogContext", () => {
  it("returns compact video and experience anchors with expected-result hints", async () => {
    const prisma = buildPrisma()

    await expect(
      readSearchEvalCatalogContext(
        prisma as unknown as Parameters<typeof readSearchEvalCatalogContext>[0],
        { locales: ["en"], limit: 10 },
      ),
    ).resolves.toEqual({
      localeProfiles: [{ locale: "en", tier: 1, source: "harness" }],
      anchors: [
        {
          source: "video",
          id: "video-locale-1",
          locale: "en",
          title: "JESUS",
          slug: "jesus",
          label: "FEATURE_FILM",
          snippet: "The story of Jesus.",
          description: expect.stringContaining("A feature film"),
          keywords: ["Jesus", "Gospel"],
          expectedResultHints: [
            {
              type: "video",
              id: "video-1",
              slug: "jesus",
              title: "JESUS",
            },
          ],
        },
        {
          source: "experience",
          id: "experience-locale-1",
          locale: "en",
          title: "Hope",
          slug: "hope",
          snippet: "Resources about hope.",
          description: "Find hope in Jesus.",
          expectedResultHints: [
            {
              type: "experience",
              id: "experience-1",
              slug: "hope",
              title: "Hope",
            },
          ],
        },
      ],
    })

    expect(prisma.videoLocale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PUBLISHED",
          title: { not: null },
          locale: { in: ["en"] },
          video: { deletedAt: null, noIndex: false },
        }),
        take: 10,
      }),
    )
    expect(prisma.experienceLocale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PUBLISHED",
          title: { not: null },
          locale: { in: ["en"] },
          experience: { archivedAt: null },
        }),
        take: 10,
      }),
    )
  })

  it("defaults to the harness locale profile set without runtime derivation", async () => {
    const prisma = buildPrisma()
    const context = await readSearchEvalCatalogContext(
      prisma as unknown as Parameters<typeof readSearchEvalCatalogContext>[0],
    )

    expect(context.localeProfiles).toHaveLength(30)
    expect(context.localeProfiles[0]).toEqual({
      locale: "en",
      tier: 1,
      source: "harness",
    })
  })

  it("rejects unsafe locale values and excessive locale lists", async () => {
    const prisma = buildPrisma()

    await expect(
      readSearchEvalCatalogContext(
        prisma as unknown as Parameters<typeof readSearchEvalCatalogContext>[0],
        { locales: ["../en"] },
      ),
    ).rejects.toBeInstanceOf(SearchEvalCatalogContextError)

    await expect(
      readSearchEvalCatalogContext(
        prisma as unknown as Parameters<typeof readSearchEvalCatalogContext>[0],
        { locales: Array.from({ length: 31 }, (_, index) => `aa-${index}`) },
      ),
    ).rejects.toMatchObject({ code: "validation" })
  })

  it("does not expose vectors, raw transcripts, blocks, bearer data, or scoring payloads", async () => {
    const prisma = buildPrisma()
    const context = await readSearchEvalCatalogContext(
      prisma as unknown as Parameters<typeof readSearchEvalCatalogContext>[0],
    )
    const serialized = JSON.stringify(context)

    expect(serialized).not.toMatch(
      /embedding|vector|transcript|blocks|bearer|cookie|ipAddress|userId|score/i,
    )
  })
})
