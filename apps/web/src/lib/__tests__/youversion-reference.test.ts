import { describe, expect, it } from "vitest"

import { toYouVersionReference } from "@/lib/youversion-reference"

const john = { name: "John" }
const galatians = { name: "Galatians" }
const genesis = { name: "Genesis" }

describe("toYouVersionReference", () => {
  it("maps a single verse citation to a YouVersion USFM reference", () => {
    expect(
      toYouVersionReference({
        osisId: "John.3.16",
        chapterStart: 3,
        chapterEnd: null,
        verseStart: 16,
        verseEnd: null,
        bibleBook: john,
      }),
    ).toBe("JHN.3.16")
  })

  it("maps a same-chapter verse range to a compact YouVersion range", () => {
    expect(
      toYouVersionReference({
        osisId: "John.3.16-John.3.17",
        chapterStart: 3,
        chapterEnd: 3,
        verseStart: 16,
        verseEnd: 17,
        bibleBook: john,
      }),
    ).toBe("JHN.3.16-17")
  })

  it("normalizes an inclusive same-verse range to a single verse reference", () => {
    expect(
      toYouVersionReference({
        osisId: "John.3.16",
        chapterStart: 3,
        chapterEnd: 3,
        verseStart: 16,
        verseEnd: 16,
        bibleBook: john,
      }),
    ).toBe("JHN.3.16")
  })

  it("maps a chapter-only citation to a chapter reference", () => {
    expect(
      toYouVersionReference({
        osisId: "Gen.3",
        chapterStart: 3,
        chapterEnd: null,
        verseStart: null,
        verseEnd: null,
        bibleBook: genesis,
      }),
    ).toBe("GEN.3")
  })

  it("falls back to the starting verse for cross-chapter ranges", () => {
    expect(
      toYouVersionReference({
        osisId: "Gal.2.20-Gal.3.5",
        chapterStart: 2,
        chapterEnd: 3,
        verseStart: 20,
        verseEnd: 5,
        bibleBook: galatians,
      }),
    ).toBe("GAL.2.20")
  })

  it("falls back to bibleBook.name when the OSIS id is missing", () => {
    expect(
      toYouVersionReference({
        osisId: null,
        chapterStart: 13,
        chapterEnd: null,
        verseStart: 4,
        verseEnd: 7,
        bibleBook: { name: "1 Corinthians" },
      }),
    ).toBe("1CO.13.4-7")
  })

  it("normalizes alternate multi-word book names in the fallback path", () => {
    expect(
      toYouVersionReference({
        osisId: "",
        chapterStart: 2,
        chapterEnd: null,
        verseStart: 1,
        verseEnd: null,
        bibleBook: { name: "Song of Solomon" },
      }),
    ).toBe("SNG.2.1")
  })

  it("returns null for unknown books", () => {
    expect(
      toYouVersionReference({
        osisId: "Imaginary.1.1",
        chapterStart: 1,
        chapterEnd: null,
        verseStart: 1,
        verseEnd: null,
        bibleBook: { name: "Imaginary" },
      }),
    ).toBeNull()
  })

  it("returns null when chapterStart is missing", () => {
    expect(
      toYouVersionReference({
        osisId: "John.3.16",
        chapterStart: null,
        chapterEnd: null,
        verseStart: 16,
        verseEnd: null,
        bibleBook: john,
      }),
    ).toBeNull()
  })

  it("returns null for hostile or malformed input", () => {
    const malformed = [
      {
        osisId: "https://example.test/John.3.16",
        chapterStart: 3,
        chapterEnd: null,
        verseStart: 16,
        verseEnd: null,
        bibleBook: john,
      },
      {
        osisId: "../John.3.16",
        chapterStart: 3,
        chapterEnd: null,
        verseStart: 16,
        verseEnd: null,
        bibleBook: { name: "../John" },
      },
      {
        osisId: "John.3.17-John.3.16",
        chapterStart: 3,
        chapterEnd: 3,
        verseStart: 17,
        verseEnd: 16,
        bibleBook: john,
      },
      null,
    ]

    for (const citation of malformed) {
      expect(toYouVersionReference(citation)).toBeNull()
    }
  })
})
