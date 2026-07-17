import { afterEach, describe, expect, it, vi } from "vitest"

function mockPrisma() {
  return {
    bibleCitation: {
      findFirst: vi.fn(),
    },
    biblePassageCache: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function makeCitation() {
  return {
    id: "bc-1",
    osisId: "John.3.16",
    chapterStart: 3,
    chapterEnd: null,
    verseStart: 16,
    verseEnd: null,
    bibleBook: { name: { en: "John" } },
  }
}

async function loadService(env: { appKey?: string; ttlSeconds?: string }) {
  vi.resetModules()
  vi.stubEnv("CI", "true")
  vi.stubEnv("YOUVERSION_APP_KEY", env.appKey ?? "")
  vi.stubEnv("YOUVERSION_PASSAGE_CACHE_TTL_SECONDS", env.ttlSeconds ?? "")
  return import("./scripture-passage.service")
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("ScripturePassageService.getPassageForCitation", () => {
  it("returns a fresh cached passage without calling YouVersion", async () => {
    const { ScripturePassageService } = await loadService({
      appKey: "app-key",
    })
    const prisma = mockPrisma()
    const fetchFn = vi.fn()
    prisma.bibleCitation.findFirst.mockResolvedValueOnce(makeCitation())
    prisma.biblePassageCache.findUnique.mockResolvedValueOnce({
      provider: "youversion",
      versionId: "3034",
      reference: "JHN.3.16",
      contentFormat: "text",
      content: "For God so loved the world.",
      humanReference: "John 3:16",
      versionAbbreviation: "BSB",
      versionTitle: "Berean Standard Bible",
      copyright: "Copyright.",
      publisherUrl: "https://example.test/version",
      expiresAt: new Date(Date.now() + 60_000),
    })

    const service = new ScripturePassageService(prisma, fetchFn as never)
    const passage = await service.getPassageForCitation({ citationId: "bc-1" })

    expect(fetchFn).not.toHaveBeenCalled()
    expect(passage).toEqual({
      content: "For God so loved the world.",
      copyright: "Copyright.",
      humanReference: "John 3:16",
      provider: "youversion",
      publisherUrl: "https://example.test/version",
      reference: "JHN.3.16",
      versionAbbreviation: "BSB",
      versionId: 3034,
      versionTitle: "Berean Standard Bible",
    })
  })

  it("fetches from YouVersion, caches the passage, and returns it on a miss", async () => {
    const { ScripturePassageService } = await loadService({
      appKey: "app-key",
      ttlSeconds: "60",
    })
    const prisma = mockPrisma()
    prisma.bibleCitation.findFirst.mockResolvedValueOnce(makeCitation())
    prisma.biblePassageCache.findUnique.mockResolvedValueOnce(null)
    prisma.biblePassageCache.upsert.mockImplementationOnce(
      async ({ create }: { create: Record<string, unknown> }) => ({
        ...create,
      }),
    )
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: 3034,
          localized_abbreviation: "BSB",
          localized_title: "Berean Standard Bible",
          copyright: "Copyright.",
          publisher_url: "https://example.test/version",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "JHN.3.16",
          reference: "John 3:16",
          content: " For God so loved the world. ",
        }),
      )

    const service = new ScripturePassageService(prisma, fetchFn as never)
    const passage = await service.getPassageForCitation({ citationId: "bc-1" })

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      "https://api.youversion.com/v1/bibles/3034",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          "X-YVP-App-Key": "app-key",
        },
      }),
    )
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      "https://api.youversion.com/v1/bibles/3034/passages/JHN.3.16?format=text&include_headings=false&include_notes=false",
      expect.any(Object),
    )
    expect(prisma.biblePassageCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_versionId_reference_contentFormat: {
            provider: "youversion",
            versionId: "3034",
            reference: "JHN.3.16",
            contentFormat: "text",
          },
        },
        create: expect.objectContaining({
          content: "For God so loved the world.",
          humanReference: "John 3:16",
          reference: "JHN.3.16",
        }),
      }),
    )
    expect(passage).toEqual(
      expect.objectContaining({
        content: "For God so loved the world.",
        humanReference: "John 3:16",
        reference: "JHN.3.16",
        versionId: 3034,
      }),
    )
  })

  it("uses the code-approved launch version id for English", async () => {
    const { ScripturePassageService } = await loadService({
      appKey: "app-key",
      ttlSeconds: "60",
    })
    const prisma = mockPrisma()
    prisma.bibleCitation.findFirst.mockResolvedValueOnce(makeCitation())
    prisma.biblePassageCache.findUnique.mockResolvedValueOnce(null)
    prisma.biblePassageCache.upsert.mockImplementationOnce(
      async ({ create }: { create: Record<string, unknown> }) => ({
        ...create,
      }),
    )
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: 3034,
          localized_abbreviation: "BSB",
          localized_title: "Berean Standard Bible",
          copyright: "Copyright.",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "JHN.3.16",
          reference: "Juan 3:16",
          content: "Porque de tal manera amo Dios al mundo.",
        }),
      )

    const service = new ScripturePassageService(prisma, fetchFn as never)
    const passage = await service.getPassageForCitation({
      citationId: "bc-1",
      languageSlug: "english",
    })

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      "https://api.youversion.com/v1/bibles/3034",
      expect.any(Object),
    )
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      "https://api.youversion.com/v1/bibles/3034/passages/JHN.3.16?format=text&include_headings=false&include_notes=false",
      expect.any(Object),
    )
    expect(prisma.biblePassageCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_versionId_reference_contentFormat: expect.objectContaining({
            versionId: "3034",
          }),
        },
      }),
    )
    expect(passage).toEqual(
      expect.objectContaining({
        humanReference: "Juan 3:16",
        versionAbbreviation: "BSB",
        versionId: 3034,
      }),
    )
  })

  it("uses the production language slug map for non-English defaults", async () => {
    const { ScripturePassageService } = await loadService({
      appKey: "app-key",
      ttlSeconds: "60",
    })
    const prisma = mockPrisma()
    prisma.bibleCitation.findFirst.mockResolvedValueOnce(makeCitation())
    prisma.biblePassageCache.findUnique.mockResolvedValueOnce(null)
    prisma.biblePassageCache.upsert.mockImplementationOnce(
      async ({ create }: { create: Record<string, unknown> }) => ({
        ...create,
      }),
    )
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: 147,
          localized_abbreviation: "NTV",
          localized_title: "Nueva Traduccion Viviente",
          copyright: "Copyright.",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "JHN.3.16",
          reference: "Juan 3:16",
          content: "Porque de tal manera amo Dios al mundo.",
        }),
      )

    const service = new ScripturePassageService(prisma, fetchFn as never)
    const passage = await service.getPassageForCitation({
      citationId: "bc-1",
      languageSlug: "spanish-latin-american",
    })

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      "https://api.youversion.com/v1/bibles/147",
      expect.any(Object),
    )
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      "https://api.youversion.com/v1/bibles/147/passages/JHN.3.16?format=text&include_headings=false&include_notes=false",
      expect.any(Object),
    )
    expect(prisma.biblePassageCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_versionId_reference_contentFormat: expect.objectContaining({
            versionId: "147",
          }),
        },
      }),
    )
    expect(passage).toEqual(
      expect.objectContaining({
        humanReference: "Juan 3:16",
        versionAbbreviation: "NTV",
        versionId: 147,
      }),
    )
  })

  it("uses the production language id map for non-English defaults", async () => {
    const { ScripturePassageService } = await loadService({
      appKey: "app-key",
      ttlSeconds: "60",
    })
    const prisma = mockPrisma()
    prisma.bibleCitation.findFirst.mockResolvedValueOnce(makeCitation())
    prisma.biblePassageCache.findUnique.mockResolvedValueOnce(null)
    prisma.biblePassageCache.upsert.mockImplementationOnce(
      async ({ create }: { create: Record<string, unknown> }) => ({
        ...create,
      }),
    )
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: 147,
          localized_abbreviation: "NTV",
          localized_title: "Nueva Traduccion Viviente",
          copyright: "Copyright.",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "JHN.3.16",
          reference: "Juan 3:16",
          content: "Porque de tal manera amo Dios al mundo.",
        }),
      )

    const service = new ScripturePassageService(prisma, fetchFn as never)
    const passage = await service.getPassageForCitation({
      citationId: "bc-1",
      languageId: "21028",
    })

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      "https://api.youversion.com/v1/bibles/147",
      expect.any(Object),
    )
    expect(prisma.biblePassageCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_versionId_reference_contentFormat: expect.objectContaining({
            versionId: "147",
          }),
        },
      }),
    )
    expect(passage).toEqual(
      expect.objectContaining({
        versionAbbreviation: "NTV",
        versionId: 147,
      }),
    )
  })

  it("uses the code-approved version id for the requested language id", async () => {
    const { ScripturePassageService } = await loadService({
      appKey: "app-key",
      ttlSeconds: "60",
    })
    const prisma = mockPrisma()
    prisma.bibleCitation.findFirst.mockResolvedValueOnce(makeCitation())
    prisma.biblePassageCache.findUnique.mockResolvedValueOnce(null)
    prisma.biblePassageCache.upsert.mockImplementationOnce(
      async ({ create }: { create: Record<string, unknown> }) => ({
        ...create,
      }),
    )
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: 3034,
          localized_abbreviation: "BSB",
          localized_title: "Berean Standard Bible",
          copyright: "Copyright.",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "JHN.3.16",
          reference: "John 3:16",
          content: "For God so loved the world.",
        }),
      )

    const service = new ScripturePassageService(prisma, fetchFn as never)
    const passage = await service.getPassageForCitation({
      citationId: "bc-1",
      languageId: "529",
    })

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      "https://api.youversion.com/v1/bibles/3034",
      expect.any(Object),
    )
    expect(prisma.biblePassageCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_versionId_reference_contentFormat: expect.objectContaining({
            versionId: "3034",
          }),
        },
      }),
    )
    expect(passage).toEqual(
      expect.objectContaining({
        versionAbbreviation: "BSB",
        versionId: 3034,
      }),
    )
  })

  it("returns null without touching the cache when no provider key is configured", async () => {
    const { ScripturePassageService } = await loadService({})
    const prisma = mockPrisma()
    const fetchFn = vi.fn()

    const service = new ScripturePassageService(prisma, fetchFn as never)
    const passage = await service.getPassageForCitation({ citationId: "bc-1" })

    expect(passage).toBeNull()
    expect(prisma.bibleCitation.findFirst).not.toHaveBeenCalled()
    expect(prisma.biblePassageCache.findUnique).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
