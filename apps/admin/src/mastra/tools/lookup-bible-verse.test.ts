import { beforeEach, describe, expect, it, vi } from "vitest"

// Also excludes `void`: Mastra's createTool types execute's return as
// `T | void`, and once the admin program's total type-instantiation load is
// high the checker keeps the `void` arm instead of resolving to T. Excluding
// it here (with a runtime null-guard) keeps these tests robust to that budget.
function assertOk<T>(value: T): Exclude<T, { error: unknown } | void> {
  if (value == null) {
    throw new Error("tool returned no result")
  }
  if (typeof value === "object" && "error" in value) {
    throw new Error("tool returned a ValidationError instead of a result")
  }
  return value as Exclude<T, { error: unknown } | void>
}

const findManyMock = vi.hoisted(() => vi.fn())

vi.mock("@/db/client", () => ({
  prisma: {
    bibleBook: {
      findMany: findManyMock,
    },
  },
}))

describe("lookupBibleVerseTool", () => {
  beforeEach(() => {
    findManyMock.mockReset()
    vi.resetModules()
  })

  it("queries by osisId / paratext / alternateName and returns localised display names", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "book-1",
        osisId: "Matt",
        name: { en: "Matthew", es: "Mateo", fr: "Matthieu" },
        testament: "NT",
        order: 40,
      },
    ])
    const { lookupBibleVerseTool } = await import("./lookup-bible-verse")
    const result = assertOk(
      await lookupBibleVerseTool.execute!(
        { query: "Matt", locale: "es", limit: 3 },
        undefined as never,
      ),
    )
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          OR: expect.any(Array),
        }),
        take: 3,
        orderBy: { order: "asc" },
      }),
    )
    expect(result.books).toEqual([
      {
        bookId: "book-1",
        osisId: "Matt",
        displayName: "Mateo",
        testament: "NT",
        order: 40,
      },
    ])
  })

  it("falls back from a regional locale to the base language (fr-CA → fr)", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "book-1",
        osisId: "Gen",
        name: { en: "Genesis", fr: "Genèse" },
        testament: "OT",
        order: 1,
      },
    ])
    const { lookupBibleVerseTool } = await import("./lookup-bible-verse")
    const result = assertOk(
      await lookupBibleVerseTool.execute!(
        { query: "Gen", locale: "fr-CA", limit: 1 },
        undefined as never,
      ),
    )
    expect(result.books[0]?.displayName).toBe("Genèse")
  })

  it("falls back to English when neither requested locale nor base is present", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "book-1",
        osisId: "Rev",
        name: { en: "Revelation" },
        testament: "NT",
        order: 66,
      },
    ])
    const { lookupBibleVerseTool } = await import("./lookup-bible-verse")
    const result = assertOk(
      await lookupBibleVerseTool.execute!(
        { query: "Rev", locale: "ja", limit: 1 },
        undefined as never,
      ),
    )
    expect(result.books[0]?.displayName).toBe("Revelation")
  })

  it("returns an empty array when no books match", async () => {
    findManyMock.mockResolvedValue([])
    const { lookupBibleVerseTool } = await import("./lookup-bible-verse")
    const result = assertOk(
      await lookupBibleVerseTool.execute!(
        { query: "Tolkien", locale: "en", limit: 3 },
        undefined as never,
      ),
    )
    expect(result.books).toEqual([])
  })

  it("rejects empty query via Zod", async () => {
    const { lookupBibleVerseInputSchema } = await import("./lookup-bible-verse")
    const parse = lookupBibleVerseInputSchema.safeParse({
      query: "",
      locale: "en",
    })
    expect(parse.success).toBe(false)
  })
})
