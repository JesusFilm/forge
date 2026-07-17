import {
  collectAllLanguages,
  LANGUAGES_PAGE_SIZE,
  MAX_LANGUAGE_PAGES,
} from "./allLanguages"
import type { RawChildDubLanguage } from "./normalizeVideo"

function makePage(count: number, offset: number): RawChildDubLanguage[] {
  return Array.from({ length: count }, (_, i) => ({
    slug: `lang-${offset + i}`,
    name: null,
    bcp47: null,
  }))
}

describe("collectAllLanguages", () => {
  it("returns a single short page without fetching more", async () => {
    const offsets: number[] = []
    const rows = await collectAllLanguages(async (offset) => {
      offsets.push(offset)
      return makePage(3, offset)
    })
    expect(rows).toHaveLength(3)
    expect(offsets).toEqual([0])
  })

  it("pages with the server's offset stride until a short page", async () => {
    const offsets: number[] = []
    const rows = await collectAllLanguages(async (offset) => {
      offsets.push(offset)
      return offset < LANGUAGES_PAGE_SIZE * 2
        ? makePage(LANGUAGES_PAGE_SIZE, offset)
        : makePage(59, offset)
    })
    expect(offsets).toEqual([0, LANGUAGES_PAGE_SIZE, LANGUAGES_PAGE_SIZE * 2])
    expect(rows).toHaveLength(LANGUAGES_PAGE_SIZE * 2 + 59)
    // Offset threading is real: rows are distinct across page boundaries.
    expect(new Set(rows.map((r) => r.slug)).size).toBe(rows.length)
  })

  it("treats an exactly-full final corpus as one more (empty) page", async () => {
    const rows = await collectAllLanguages(async (offset) =>
      offset === 0 ? makePage(LANGUAGES_PAGE_SIZE, offset) : [],
    )
    expect(rows).toHaveLength(LANGUAGES_PAGE_SIZE)
  })

  it("stops at the page ceiling even when every page comes back full", async () => {
    let calls = 0
    const rows = await collectAllLanguages(async (offset) => {
      calls++
      return makePage(LANGUAGES_PAGE_SIZE, offset)
    })
    expect(calls).toBe(MAX_LANGUAGE_PAGES)
    expect(rows).toHaveLength(LANGUAGES_PAGE_SIZE * MAX_LANGUAGE_PAGES)
  })

  it("rejects when a page rejects (one retryable error, no partial success)", async () => {
    await expect(
      collectAllLanguages(async (offset) => {
        if (offset > 0) throw new Error("boom")
        return makePage(LANGUAGES_PAGE_SIZE, offset)
      }),
    ).rejects.toThrow("boom")
  })
})
