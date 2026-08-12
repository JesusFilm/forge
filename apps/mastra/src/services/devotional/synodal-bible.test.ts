import { describe, expect, it, vi } from "vitest"

import { fetchSynodalPassage, parseReference } from "./synodal-bible"

describe("parseReference", () => {
  it("parses a human single verse", () => {
    expect(parseReference("Luke 19:10")).toEqual({
      osisBook: "Luke",
      chapter: 19,
      verseStart: 10,
      verseEnd: 10,
    })
  })
  it("parses a human verse range", () => {
    expect(parseReference("Luke 8:22-25")).toMatchObject({
      osisBook: "Luke",
      chapter: 8,
      verseStart: 22,
      verseEnd: 25,
    })
  })
  it("maps a multi-word English book name to OSIS", () => {
    expect(parseReference("Matthew 5:3")?.osisBook).toBe("Matt")
  })
  it("parses an OSIS range", () => {
    expect(parseReference("Luke.19.1-Luke.19.10")).toMatchObject({
      chapter: 19,
      verseStart: 1,
      verseEnd: 10,
    })
  })
  it("returns null on garbage", () => {
    expect(parseReference("not a reference")).toBeNull()
  })
})

describe("fetchSynodalPassage", () => {
  const chapter = {
    book_name: "Лука",
    verses: [
      { verse: 9, text: "стих девять" },
      { verse: 10, text: "Ибо Сын Человеческий пришел взыскать и спасти погибшее." },
      { verse: 11, text: "стих одиннадцать" },
    ],
  }

  it("returns only the focused verse + a Russian citation", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => chapter,
    })
    const out = await fetchSynodalPassage("Luke 19:10", {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(out.reference).toBe("От Луки 19:10")
    expect(out.text).toBe(
      "Ибо Сын Человеческий пришел взыскать и спасти погибшее.",
    )
    // only verse 10, not 9 or 11
    expect(out.text).not.toContain("девять")
    expect(out.text).not.toContain("одиннадцать")
  })

  it("throws unsupported_reference for an unmapped book", async () => {
    await expect(fetchSynodalPassage("Zzz 1:1")).rejects.toMatchObject({
      code: "unsupported_reference",
    })
  })
})
