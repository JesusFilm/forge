import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ORIGINAL_ENV = { ...process.env }

function useBaseEnv() {
  process.env.ADMIN_GRAPHQL_URL = "http://localhost:1437/admin/api/graphql"
  process.env.WEB_ADMIN_API_KEYS = "test-admin-bearer-key"
  process.env.REVALIDATION_SECRET = "test-revalidation-secret"
  process.env.YOUVERSION_APP_KEY = "server-yv-key"
  process.env.YOUVERSION_DEFAULT_VERSION_ID = "3034"
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, ...init })
}

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    copyright: "Copyright text from YouVersion.",
    id: 3034,
    localized_abbreviation: "BSB",
    localized_title: "Berean Standard Bible",
    publisher_url: "https://example.test/publisher",
    ...overrides,
  }
}

function makePassage(overrides: Record<string, unknown> = {}) {
  return {
    content: "For God so loved the world.",
    id: "JHN.3.16",
    reference: "John 3:16",
    ...overrides,
  }
}

function makeCitation(
  overrides: Partial<{
    bibleBookName: string | null
    chapterStart: number | null
    documentId: string | null
    order: number
    osisId: string | null
    verseStart: number | null
  }> = {},
) {
  return {
    bibleBook: {
      documentId: "book-john",
      name:
        overrides.bibleBookName === undefined
          ? "John"
          : overrides.bibleBookName,
    },
    chapterEnd: null,
    chapterStart:
      overrides.chapterStart === undefined ? 3 : overrides.chapterStart,
    documentId:
      overrides.documentId === undefined
        ? "citation-john-3-16"
        : overrides.documentId,
    order: overrides.order ?? 1,
    osisId: overrides.osisId === undefined ? "John.3.16" : overrides.osisId,
    verseEnd: null,
    verseStart: overrides.verseStart === undefined ? 16 : overrides.verseStart,
  }
}

describe("fetchYouVersionBibleQuotePassages", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    useBaseEnv()
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...ORIGINAL_ENV }
  })

  it("fetches passage text server-side with the private app key and returns no key to the client", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(makeVersion()))
      .mockResolvedValueOnce(jsonResponse(makePassage()))

    const { fetchYouVersionBibleQuotePassages } =
      await import("@/lib/youversion-passage")

    const passages = await fetchYouVersionBibleQuotePassages([makeCitation()])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.youversion.com/v1/bibles/3034",
    )
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://api.youversion.com/v1/bibles/3034/passages/JHN.3.16?format=text&include_headings=false&include_notes=false",
    )
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-YVP-App-Key": "server-yv-key",
          }),
        }),
      )
    }
    expect(passages).toEqual([
      expect.objectContaining({
        citationDocumentId: "citation-john-3-16",
        content: "For God so loved the world.",
        copyright: "Copyright text from YouVersion.",
        humanReference: "John 3:16",
        publisherUrl: "https://example.test/publisher",
        reference: "JHN.3.16",
        versionAbbreviation: "BSB",
        versionId: 3034,
        versionTitle: "Berean Standard Bible",
      }),
    ])
    expect(JSON.stringify(passages)).not.toContain("server-yv-key")
  })

  it("uses the current REST copyright field for required attribution", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          makeVersion({
            copyright: "REST shape copyright.",
            copyright_long: null,
            copyright_short: null,
          }),
        ),
      )
      .mockResolvedValueOnce(jsonResponse(makePassage()))

    const { fetchYouVersionBibleQuotePassages } =
      await import("@/lib/youversion-passage")

    await expect(
      fetchYouVersionBibleQuotePassages([makeCitation()]),
    ).resolves.toEqual([
      expect.objectContaining({ copyright: "REST shape copyright." }),
    ])
  })

  it("does not call YouVersion when the server app key is absent", async () => {
    delete process.env.YOUVERSION_APP_KEY

    const { fetchYouVersionBibleQuotePassages } =
      await import("@/lib/youversion-passage")

    await expect(
      fetchYouVersionBibleQuotePassages([makeCitation()]),
    ).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not fetch version metadata when every citation is unrenderable", async () => {
    const { fetchYouVersionBibleQuotePassages } =
      await import("@/lib/youversion-passage")

    await expect(
      fetchYouVersionBibleQuotePassages([
        null,
        makeCitation({ documentId: null }),
        makeCitation({ osisId: "Bogus.3.16" }),
        makeCitation({ chapterStart: null }),
      ]),
    ).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not return un-attributed passage text when version metadata fails", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    )

    const { fetchYouVersionBibleQuotePassages } =
      await import("@/lib/youversion-passage")

    await expect(
      fetchYouVersionBibleQuotePassages([makeCitation()]),
    ).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not return passage text when version metadata omits copyright", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        makeVersion({
          copyright: null,
          copyright_long: null,
          copyright_short: null,
        }),
      ),
    )

    const { fetchYouVersionBibleQuotePassages } =
      await import("@/lib/youversion-passage")

    await expect(
      fetchYouVersionBibleQuotePassages([makeCitation()]),
    ).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("drops unsafe publisher URLs from the browser payload", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(makeVersion({ publisher_url: "javascript:alert(1)" })),
      )
      .mockResolvedValueOnce(jsonResponse(makePassage()))

    const { fetchYouVersionBibleQuotePassages } =
      await import("@/lib/youversion-passage")

    await expect(
      fetchYouVersionBibleQuotePassages([makeCitation()]),
    ).resolves.toEqual([expect.objectContaining({ publisherUrl: null })])
  })

  it("omits only the citation whose passage request fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(makeVersion()))
      .mockResolvedValueOnce(jsonResponse(makePassage({ id: "JHN.3.16" })))
      .mockResolvedValueOnce(new Response("Server error", { status: 500 }))

    const { fetchYouVersionBibleQuotePassages } =
      await import("@/lib/youversion-passage")

    await expect(
      fetchYouVersionBibleQuotePassages([
        makeCitation({
          documentId: "citation-john-3-16",
          osisId: "John.3.16",
          verseStart: 16,
        }),
        makeCitation({
          documentId: "citation-john-3-17",
          osisId: "John.3.17",
          verseStart: 17,
        }),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ citationDocumentId: "citation-john-3-16" }),
    ])
  })

  it("deduplicates repeated references and limits passage fetches", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(makeVersion()))
      .mockResolvedValueOnce(
        jsonResponse(makePassage({ id: "JHN.3.16", reference: "John 3:16" })),
      )
      .mockResolvedValueOnce(
        jsonResponse(makePassage({ id: "JHN.3.17", reference: "John 3:17" })),
      )
      .mockResolvedValueOnce(
        jsonResponse(makePassage({ id: "JHN.3.18", reference: "John 3:18" })),
      )
      .mockResolvedValueOnce(
        jsonResponse(makePassage({ id: "JHN.3.19", reference: "John 3:19" })),
      )
      .mockResolvedValueOnce(
        jsonResponse(makePassage({ id: "JHN.3.20", reference: "John 3:20" })),
      )

    const { fetchYouVersionBibleQuotePassages } =
      await import("@/lib/youversion-passage")

    const passages = await fetchYouVersionBibleQuotePassages([
      makeCitation({
        documentId: "citation-john-3-16",
        osisId: "John.3.16",
        verseStart: 16,
      }),
      makeCitation({
        documentId: "citation-john-3-16-copy",
        osisId: "John.3.16",
        verseStart: 16,
      }),
      makeCitation({
        documentId: "citation-john-3-17",
        osisId: "John.3.17",
        verseStart: 17,
      }),
      makeCitation({
        documentId: "citation-john-3-18",
        osisId: "John.3.18",
        verseStart: 18,
      }),
      makeCitation({
        documentId: "citation-john-3-19",
        osisId: "John.3.19",
        verseStart: 19,
      }),
      makeCitation({
        documentId: "citation-john-3-20",
        osisId: "John.3.20",
        verseStart: 20,
      }),
      makeCitation({
        documentId: "citation-john-3-21",
        osisId: "John.3.21",
        verseStart: 21,
      }),
    ])

    expect(passages).toHaveLength(6)
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("JHN.3.21")),
    ).toBe(false)
  })

  it.each([
    [
      "fetch rejection",
      () => fetchMock.mockRejectedValueOnce(new Error("down")),
    ],
    [
      "invalid JSON",
      () =>
        fetchMock.mockResolvedValueOnce(
          new Response("not-json", { status: 200 }),
        ),
    ],
    [
      "invalid response shape",
      () => fetchMock.mockResolvedValueOnce(jsonResponse({ id: "3034" })),
    ],
  ])(
    "fails closed when version metadata has %s",
    async (_caseName, arrange) => {
      arrange()

      const { fetchYouVersionBibleQuotePassages } =
        await import("@/lib/youversion-passage")

      await expect(
        fetchYouVersionBibleQuotePassages([makeCitation()]),
      ).resolves.toEqual([])
    },
  )
})
