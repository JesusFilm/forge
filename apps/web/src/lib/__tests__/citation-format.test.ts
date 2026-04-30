/**
 * U8 — `formatCitation()` covers all 4 branches of the BibleCitation shape.
 *
 * Branch 1: single verse (chapterEnd null, verseEnd null).
 * Branch 2: same-chapter verse range — explicit chapterEnd OR null, with
 *   verseEnd defined. Uses hyphen-minus (`-`).
 * Branch 3: cross-chapter range with both endpoints. Uses en-dash (`–`).
 * Branch 4: cross-chapter "through end of chapter" (verseEnd null).
 *   Uses en-dash (`–`).
 *
 * Fallback: missing bibleBook or missing book.name → "Unknown Book ...".
 */

import { describe, expect, it } from "vitest"

import { formatCitation } from "@/lib/citation-format"

const galatians = { name: "Galatians" }

describe("formatCitation — branch 1: single verse", () => {
  it("formats Galatians 2:20 with chapterEnd null and verseEnd null", () => {
    expect(
      formatCitation({
        chapterStart: 2,
        chapterEnd: null,
        verseStart: 20,
        verseEnd: null,
        bibleBook: galatians,
      }),
    ).toBe("Galatians 2:20")
  })
})

describe("formatCitation — branch 2: same-chapter verse range (hyphen-minus)", () => {
  it("formats Galatians 2:20-25 when chapterEnd null and verseEnd present", () => {
    expect(
      formatCitation({
        chapterStart: 2,
        chapterEnd: null,
        verseStart: 20,
        verseEnd: 25,
        bibleBook: galatians,
      }),
    ).toBe("Galatians 2:20-25")
  })

  it("formats Galatians 2:20-25 when chapterEnd equals chapterStart", () => {
    expect(
      formatCitation({
        chapterStart: 2,
        chapterEnd: 2,
        verseStart: 20,
        verseEnd: 25,
        bibleBook: galatians,
      }),
    ).toBe("Galatians 2:20-25")
  })

  it("uses ASCII hyphen-minus, NOT en-dash, for same-chapter ranges", () => {
    const out = formatCitation({
      chapterStart: 2,
      chapterEnd: null,
      verseStart: 20,
      verseEnd: 25,
      bibleBook: galatians,
    })
    expect(out).toContain("-")
    expect(out).not.toContain("–")
  })
})

describe("formatCitation — branch 3: cross-chapter range with end verse (en-dash)", () => {
  it("formats Galatians 2:20–3:5 when chapterEnd differs and verseEnd present", () => {
    expect(
      formatCitation({
        chapterStart: 2,
        chapterEnd: 3,
        verseStart: 20,
        verseEnd: 5,
        bibleBook: galatians,
      }),
    ).toBe("Galatians 2:20–3:5")
  })

  it("uses en-dash (U+2013), NOT hyphen-minus, for cross-chapter ranges", () => {
    const out = formatCitation({
      chapterStart: 2,
      chapterEnd: 3,
      verseStart: 20,
      verseEnd: 5,
      bibleBook: galatians,
    })
    // The cross-chapter separator must be en-dash. We allow no hyphen-minus
    // anywhere in branch 3 output (book name "Galatians" has none).
    expect(out).toContain("–")
    expect(out).not.toContain("-")
  })
})

describe("formatCitation — branch 4: cross-chapter through-end-of-chapter (en-dash)", () => {
  it("formats Galatians 2:20–3 when chapterEnd differs and verseEnd is null", () => {
    expect(
      formatCitation({
        chapterStart: 2,
        chapterEnd: 3,
        verseStart: 20,
        verseEnd: null,
        bibleBook: galatians,
      }),
    ).toBe("Galatians 2:20–3")
  })
})

describe("formatCitation — fallback: missing bibleBook / book.name", () => {
  it("substitutes 'Unknown Book' when bibleBook is null", () => {
    expect(
      formatCitation({
        chapterStart: 2,
        chapterEnd: null,
        verseStart: 20,
        verseEnd: null,
        bibleBook: null,
      }),
    ).toBe("Unknown Book 2:20")
  })

  it("substitutes 'Unknown Book' when bibleBook.name is null", () => {
    expect(
      formatCitation({
        chapterStart: 2,
        chapterEnd: null,
        verseStart: 20,
        verseEnd: null,
        bibleBook: { name: null },
      }),
    ).toBe("Unknown Book 2:20")
  })

  it("substitutes 'Unknown Book' when bibleBook is undefined", () => {
    expect(
      formatCitation({
        chapterStart: 2,
        chapterEnd: null,
        verseStart: 20,
        verseEnd: null,
      }),
    ).toBe("Unknown Book 2:20")
  })

  it("does not crash and still renders the range when book missing on a cross-chapter citation", () => {
    expect(
      formatCitation({
        chapterStart: 2,
        chapterEnd: 3,
        verseStart: 20,
        verseEnd: 5,
        bibleBook: null,
      }),
    ).toBe("Unknown Book 2:20–3:5")
  })
})
