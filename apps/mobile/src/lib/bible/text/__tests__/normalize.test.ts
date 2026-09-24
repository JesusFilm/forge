// Each fixture is a real bible.helloao.org response from 2026-09-25; Prettier
// changed only its whitespace. A test that changes a fixture clones it first
// and has "Synthetic" in its name.
import arabicJohn3 from "./fixtures/arb_vdv-jhn-3.json"
import bsb3John1 from "./fixtures/bsb-3jn-1.json"
import bsbComplete2John3John from "./fixtures/bsb-complete-2jn-3jn.json"
import bsbGenesis3 from "./fixtures/bsb-gen-3.json"
import bsbMatthew18 from "./fixtures/bsb-mat-18.json"
import bsbPsalm23 from "./fixtures/bsb-psa-23.json"
import bsbPsalm3 from "./fixtures/bsb-psa-3.json"
import bsbZechariah12 from "./fixtures/bsb-zec-12.json"
import t4tJohn4 from "./fixtures/eng_t4t-jhn-4.json"
import ulbIsaiah16 from "./fixtures/eng_ulb-isa-16.json"
import ulbMatthew18 from "./fixtures/eng_ulb-mat-18.json"
import webJohn3 from "./fixtures/engwebp-jhn-3.json"
import webPsalm119 from "./fixtures/engwebp-psa-119.json"
import webRomans16 from "./fixtures/engwebp-rom-16.json"
import synodalPsalm50 from "./fixtures/rus_syn-psa-50.json"
import {
  BIBLE_BOOKS,
  bookByOsis,
  bookByUsfm,
  bookOrder,
  isUsfmBookId,
} from "../books"
import {
  normalizeBook,
  normalizeChapterFile,
  normalizeTranslation,
  parseBookText,
  parseChapterText,
} from "../normalize"
import { chapterPositions, verseThrough } from "../positions"
import {
  BIBLE_TEXT_FORMAT_VERSION,
  type Chapter,
  type TextResult,
  type Verse,
} from "../types"

const CHAPTER_FIXTURES = {
  "arb_vdv JHN 3": arabicJohn3,
  "BSB 3JN 1": bsb3John1,
  "BSB GEN 3": bsbGenesis3,
  "BSB MAT 18": bsbMatthew18,
  "BSB PSA 23": bsbPsalm23,
  "BSB PSA 3": bsbPsalm3,
  "BSB ZEC 12": bsbZechariah12,
  "eng_t4t JHN 4": t4tJohn4,
  "eng_ulb ISA 16": ulbIsaiah16,
  "eng_ulb MAT 18": ulbMatthew18,
  "ENGWEBP JHN 3": webJohn3,
  "ENGWEBP PSA 119": webPsalm119,
  "ENGWEBP ROM 16": webRomans16,
  "rus_syn PSA 50": synodalPsalm50,
} as const

function expectOk<T>(result: TextResult<T>): T {
  expect(result).toMatchObject({ status: "ok" })
  if (result.status !== "ok") {
    throw new TypeError(`the normalizer rejected the input: ${result.reason}`)
  }
  return result.value
}

function chapterOf(raw: unknown): Chapter {
  return expectOk(normalizeChapterFile(raw)).chapter
}

function verseOf(chapter: Chapter, number: number): Verse {
  const verse = chapter.verses.find((candidate) => candidate.number === number)
  if (verse === undefined) {
    throw new TypeError(`verse ${number} is not in the chapter`)
  }
  return verse
}

function lineTexts(verse: Verse): string[] {
  return verse.lines.map((line) => line.text)
}

function allLineTexts(chapter: Chapter): string[] {
  return chapter.verses.flatMap(lineTexts)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type RawItem = { type: string; content?: unknown; number?: unknown }

function contentItems(fixture: { chapter: { content: unknown[] } }): RawItem[] {
  return fixture.chapter.content as RawItem[]
}

function headingTexts(fixture: { chapter: { content: unknown[] } }): string[] {
  return contentItems(fixture)
    .filter((item) => item.type === "heading")
    .flatMap((item) => item.content as string[])
}

describe("normalizeChapterFile: real chapters", () => {
  it("normalizes BSB Psalm 23 to 6 verses with complete poetry lines", () => {
    const text = expectOk(normalizeChapterFile(bsbPsalm23))

    expect(text).toMatchObject({
      formatVersion: BIBLE_TEXT_FORMAT_VERSION,
      translationId: "BSB",
      bookId: "PSA",
      bookName: "Psalms",
      textDirection: "ltr",
    })
    expect(text.chapter.number).toBe(23)
    expect(text.chapter.lastVerse).toBe(6)
    expect(text.chapter.verses.map((verse) => verse.number)).toEqual([
      1, 2, 3, 4, 5, 6,
    ])
    // The footnote reference between the two lines leaves no marker.
    expect(verseOf(text.chapter, 1).lines).toEqual([
      { text: "The LORD is my shepherd;", poem: 1 },
      { text: "I shall not want.", poem: 2 },
    ])
    // The explicit break between two level-2 lines keeps them apart.
    expect(verseOf(text.chapter, 3).lines).toEqual([
      { text: "He restores my soul;", poem: 1 },
      { text: "He guides me in the paths of righteousness", poem: 2 },
      { text: "for the sake of His name.", poem: 2 },
    ])
  })

  it("hides the BSB Psalm title (hebrew_subtitle) and the section heading", () => {
    const texts = allLineTexts(chapterOf(bsbPsalm23))

    expect(texts).not.toContain("A Psalm of David.")
    expect(texts.join("\n")).not.toContain("The LORD Is My Shepherd")
  })

  it("reports BSB Matthew 18 with last verse 35 and a visible gap at 11", () => {
    const chapter = chapterOf(bsbMatthew18)

    expect(chapter.lastVerse).toBe(35)
    expect(chapter.verses.map((verse) => verse.number)).not.toContain(11)
    // 18:11 is a known textual omission, so verse 10 does not absorb it.
    expect(verseOf(chapter, 10).through).toBeUndefined()

    const positions = chapterPositions(chapter)
    expect(positions).toHaveLength(35)
    expect(positions[10]).toEqual({ kind: "gap", number: 11 })
    expect(positions[11]).toMatchObject({
      kind: "verse",
      verse: { number: 12 },
    })
  })

  it("puts one space where a prose footnote marker was, as eBible.org prints it", () => {
    const chapter = chapterOf(bsbMatthew18)

    expect(lineTexts(verseOf(chapter, 15))).toEqual([
      "If your brother sins against you, go and confront him privately. If he listens to you, you have won your brother over.",
    ])
    expect(lineTexts(verseOf(chapter, 28))).toEqual([
      "But when that servant went out, he found one of his fellow servants who owed him a hundred denarii. He grabbed him and began to choke him, saying, ‘Pay back what you owe me!’",
    ])
  })

  it("keeps a verse marker that holds only a footnote as a gap (ULB Matthew 18:11)", () => {
    const chapter = chapterOf(ulbMatthew18)

    expect(chapter.lastVerse).toBe(35)
    expect(chapter.verses.map((verse) => verse.number)).not.toContain(11)
    expect(verseOf(chapter, 10).through).toBeUndefined()
    expect(chapterPositions(chapter)[10]).toEqual({ kind: "gap", number: 11 })
  })

  it("counts an empty last marker in the chapter length (WEB Romans 16:25)", () => {
    // WEB moves the doxology to 14:24-26 and keeps only a note at 16:25, so
    // the reader shows the R21 note there instead of ending on verse 24.
    const chapter = chapterOf(webRomans16)

    expect(chapter.lastVerse).toBe(25)
    expect(chapter.verses.at(-1)?.number).toBe(24)
    expect(chapterPositions(chapter).at(-1)).toEqual({
      kind: "gap",
      number: 25,
    })
  })

  it("keeps Synodal Psalm 50 verses 1 and 2 (the title) as verses", () => {
    const text = expectOk(normalizeChapterFile(synodalPsalm50))

    expect(text.translationId).toBe("rus_syn")
    expect(text.chapter.lastVerse).toBe(21)
    expect(text.chapter.verses).toHaveLength(21)
    expect(lineTexts(verseOf(text.chapter, 1))).toEqual([
      "Начальнику хора. Псалом Давида,",
    ])
    expect(lineTexts(verseOf(text.chapter, 2))).toEqual([
      "когда приходил к нему пророк Нафан, после того, как Давид вошел к Вирсавии.",
    ])
    // Each verse ends with a line break item; no empty line survives it.
    for (const verse of text.chapter.verses) {
      expect(verse.lines).toHaveLength(1)
    }
  })

  it("reports rtl for the Arabic Van Dyck Bible", () => {
    const text = expectOk(normalizeChapterFile(arabicJohn3))

    expect(text.textDirection).toBe("rtl")
    expect(text.bookName).toBe("يُوحَنّا")
    expect(text.chapter.verses).toHaveLength(36)
    expect(text.chapter.lastVerse).toBe(36)
  })

  it("keeps a merged verse range as one position (T4T John 4: 1-2, 6-8, 43-44)", () => {
    const chapter = chapterOf(t4tJohn4)

    expect(chapter.lastVerse).toBe(54)
    expect(verseOf(chapter, 1).through).toBe(2)
    expect(verseOf(chapter, 6).through).toBe(8)
    expect(verseOf(chapter, 43).through).toBe(44)
    expect(verseThrough(verseOf(chapter, 5))).toBe(5)
    expect(verseThrough(verseOf(chapter, 6))).toBe(8)

    // No position shows a "missing verse" note for text that verse 6 holds.
    const positions = chapterPositions(chapter)
    expect(positions).toHaveLength(50)
    expect(
      positions.filter((position) => position.kind === "gap"),
    ).toHaveLength(0)
  })

  it("starts a new line for prose after poetry (BSB Psalm 3:2 'Selah')", () => {
    // The API's own simple format glues this into "him.”Selah".
    expect(lineTexts(verseOf(chapterOf(bsbPsalm3), 2))).toEqual([
      "Many say of me,",
      "“God will not deliver him.”",
      "Selah",
    ])
  })

  it("keeps one poetry line whole across a footnote (BSB Genesis 3:15)", () => {
    // eBible.org prints "and you will strike his heel.[note]”" as one line.
    expect(lineTexts(verseOf(chapterOf(bsbGenesis3), 15))).toEqual([
      "And I will put enmity between you and the woman,",
      "and between your seed and her seed.",
      "He will crush your head,",
      "and you will strike his heel.”",
    ])
  })

  it("keeps two same-level lines apart when no marker joins them (ULB Isaiah 16:4)", () => {
    expect(lineTexts(verseOf(chapterOf(ulbIsaiah16), 4))).toEqual([
      "Let them live among you, the refugees from Moab;",
      "be a hiding place for them from the destroyer.”",
      "For the oppression will stop, and destruction will cease,",
      "those who trample will disappear from the land.",
    ])
  })

  it("joins red-letter text with a space (World English Bible John 3:3)", () => {
    // The API's own simple format glues this into "him,“Most".
    expect(lineTexts(verseOf(chapterOf(webJohn3), 3))).toEqual([
      "Jesus answered him, “Most certainly I tell you, unless one is born anew, he can’t see God’s Kingdom.”",
    ])
  })

  it("keeps descriptive text that opens a verse (BSB Zechariah 12:1)", () => {
    expect(lineTexts(verseOf(chapterOf(bsbZechariah12), 1))).toEqual([
      "This is the burden of the word of the LORD concerning Israel.",
      "Thus declares the LORD, who stretches out the heavens and lays the foundation of the earth, who forms the spirit of man within him:",
    ])
  })

  it("drops a stanza label that follows verse text (World English Bible Psalm 119)", () => {
    const chapter = chapterOf(webPsalm119)

    expect(chapter.verses).toHaveLength(176)
    expect(lineTexts(verseOf(chapter, 8))).toEqual([
      "I will observe your statutes.",
      "Don’t utterly forsake me.",
    ])
    const texts = allLineTexts(chapter)
    for (const label of ["BETH", "GIMEL", "TAV", "SIN AND SHIN"]) {
      expect(texts).not.toContain(label)
    }
  })

  describe.each(Object.entries(CHAPTER_FIXTURES))("%s", (_name, fixture) => {
    it("has no footnote text and no heading text inside any verse", () => {
      const joined = allLineTexts(chapterOf(fixture)).join("\n")

      for (const footnote of fixture.chapter.footnotes as { text: string }[]) {
        expect(joined).not.toContain(footnote.text)
      }
      for (const heading of headingTexts(fixture)) {
        expect(joined).not.toContain(heading)
      }
    })

    it("has only trimmed, non-empty lines and ascending verse numbers", () => {
      const chapter = chapterOf(fixture)

      for (const text of allLineTexts(chapter)) {
        expect(text.length).toBeGreaterThan(0)
        expect(text).toBe(text.trim())
      }
      const numbers = chapter.verses.map((verse) => verse.number)
      expect([...numbers].sort((a, b) => a - b)).toEqual(numbers)
      expect(chapter.lastVerse).toBeGreaterThanOrEqual(
        Math.max(...chapter.verses.map(verseThrough)),
      )
    })
  })
})

describe("normalizeChapterFile: fail-closed", () => {
  it("drops an unknown item type and keeps the verses (Synthetic: BSB Psalm 23)", () => {
    const raw = clone(bsbPsalm23)
    contentItems(raw).splice(2, 0, {
      type: "audio_marker",
      content: ["Do not show this"],
    })

    const chapter = chapterOf(raw)
    expect(chapter).toEqual(chapterOf(bsbPsalm23))
    expect(allLineTexts(chapter).join("\n")).not.toContain("Do not show this")
  })

  it("drops an unknown verse part and keeps the verse text (Synthetic: BSB Psalm 23)", () => {
    const raw = clone(bsbPsalm23)
    const verse1 = contentItems(raw).find((item) => item.number === 1)
    ;(verse1?.content as unknown[]).splice(1, 0, { crossReference: "REV 7:17" })

    expect(verseOf(chapterOf(raw), 1)).toEqual(
      verseOf(chapterOf(bsbPsalm23), 1),
    )
  })

  it("returns a typed failure, not an empty chapter, when content is missing", () => {
    const raw = clone(bsbPsalm23) as { chapter: Record<string, unknown> }
    delete raw.chapter.content

    expect(normalizeChapterFile(raw)).toEqual({
      status: "rejected",
      reason: "malformed-chapter",
      bookId: "PSA",
    })
  })

  it.each([null, "BSB PSA 23", [], { translation: {} }])(
    "rejects a source that is not a chapter file: %p",
    (raw) => {
      expect(normalizeChapterFile(raw)).toMatchObject({ status: "rejected" })
    },
  )

  it("rejects a chapter that holds no verses (Synthetic: headings only)", () => {
    const raw = clone(bsbPsalm23) as { chapter: { content: unknown[] } }
    raw.chapter.content = contentItems(raw).filter(
      (item) => item.type === "heading",
    )

    expect(normalizeChapterFile(raw)).toEqual({
      status: "rejected",
      reason: "no-verses",
      bookId: "PSA",
      chapterNumber: 23,
    })
  })

  it.each([0, -1, 1.5, "1", null])(
    "rejects a verse whose number is %p (Synthetic: BSB Psalm 23)",
    (badNumber) => {
      const raw = clone(bsbPsalm23)
      const verse1 = contentItems(raw).find((item) => item.number === 1)
      if (verse1 !== undefined) verse1.number = badNumber

      expect(normalizeChapterFile(raw)).toEqual({
        status: "rejected",
        reason: "invalid-verse",
        bookId: "PSA",
        chapterNumber: 23,
      })
    },
  )

  it.each([undefined, "", "auto", "RTL"])(
    "rejects text direction %p (Synthetic: BSB Psalm 23)",
    (direction) => {
      const raw = clone(bsbPsalm23) as {
        translation: Record<string, unknown>
      }
      raw.translation.textDirection = direction

      expect(normalizeChapterFile(raw)).toEqual({
        status: "rejected",
        reason: "invalid-text-direction",
      })
    },
  )

  it("rejects a book outside the 66-book canon (Synthetic: BSB Psalm 23 as TOB)", () => {
    const raw = clone(bsbPsalm23)
    raw.book.id = "TOB"

    expect(normalizeChapterFile(raw)).toEqual({
      status: "rejected",
      reason: "unknown-book",
      bookId: "TOB",
    })
  })

  it("keeps an empty verse marker as a gap, not a merge (Synthetic: T4T John 4)", () => {
    // The marker shape is real (ULB Matthew 18:11 above). Synthetic part: in
    // the surveyed data, every mid-chapter empty marker is on the omission list.
    const raw = clone(t4tJohn4)
    const items = contentItems(raw)
    const index = items.findIndex((item) => item.number === 3)
    items.splice(index, 0, {
      type: "verse",
      number: 2,
      content: [{ noteId: 1 }],
    })

    const chapter = chapterOf(raw)
    expect(verseOf(chapter, 1).through).toBeUndefined()
    expect(chapter.verses.map((verse) => verse.number)).not.toContain(2)
    expect(chapterPositions(chapter)[1]).toEqual({ kind: "gap", number: 2 })
  })

  it("joins a verse that the source splits into two items (Synthetic: BSB Psalm 23)", () => {
    const raw = clone(bsbPsalm23)
    const items = contentItems(raw)
    const index = items.findIndex((item) => item.number === 5)
    items.splice(index + 1, 0, {
      type: "verse",
      number: 5,
      content: [{ text: "A second part of verse 5.", poem: 1 }],
    })

    const verse5 = verseOf(chapterOf(raw), 5)
    expect(lineTexts(verse5).at(-1)).toBe("A second part of verse 5.")
    expect(chapterOf(raw).verses).toHaveLength(6)
  })
})

describe("normalizeBook and normalizeTranslation", () => {
  it("normalizes a complete.json translation into per-book files", () => {
    const translation = expectOk(normalizeTranslation(bsbComplete2John3John))

    expect(translation.translationId).toBe("BSB")
    expect(translation.textDirection).toBe("ltr")
    expect(translation.skippedBookIds).toEqual([])
    expect(translation.books.map((book) => book.bookId)).toEqual(["2JN", "3JN"])

    const [secondJohn, thirdJohn] = translation.books
    expect(secondJohn).toMatchObject({
      formatVersion: BIBLE_TEXT_FORMAT_VERSION,
      translationId: "BSB",
      bookName: "2 John",
      textDirection: "ltr",
    })
    expect(secondJohn?.chapters.map((chapter) => chapter.lastVerse)).toEqual([
      13,
    ])
    expect(thirdJohn?.chapters.map((chapter) => chapter.lastVerse)).toEqual([
      14,
    ])
  })

  it("produces one chapter shape from a chapter file and from complete.json", () => {
    const fromChapterFile = chapterOf(bsb3John1)
    const book = expectOk(
      normalizeBook(
        bsbComplete2John3John.translation,
        bsbComplete2John3John.books[1],
      ),
    )

    expect(book.bookId).toBe("3JN")
    expect(book.chapters).toEqual([fromChapterFile])
  })

  it("skips books outside the 66-book canon and reports them (Synthetic: 3JN as TOB)", () => {
    // eng_webc's real books.json lists TOB, JDT, ESG, WIS, SIR, BAR, 1MA, 2MA, DAG.
    const raw = clone(bsbComplete2John3John)
    const extra = clone(raw.books[1])
    if (extra !== undefined) raw.books.push({ ...extra, id: "TOB" })

    const translation = expectOk(normalizeTranslation(raw))
    expect(translation.skippedBookIds).toEqual(["TOB"])
    expect(translation.books.map((book) => book.bookId)).toEqual(["2JN", "3JN"])
  })

  it("sorts books into canon order (Synthetic: 3JN listed before 2JN)", () => {
    const raw = clone(bsbComplete2John3John)
    raw.books.reverse()

    const translation = expectOk(normalizeTranslation(raw))
    expect(translation.books.map((book) => book.bookId)).toEqual(["2JN", "3JN"])
  })

  it("rejects the whole translation when one chapter is malformed (Synthetic)", () => {
    const raw = clone(bsbComplete2John3John) as unknown as {
      books: { chapters: { chapter: Record<string, unknown> }[] }[]
    }
    const chapter = raw.books[1]?.chapters[0]?.chapter
    if (chapter !== undefined) delete chapter.content

    expect(normalizeTranslation(raw)).toEqual({
      status: "rejected",
      reason: "malformed-chapter",
      bookId: "3JN",
    })
  })

  it("rejects a translation that lists one book twice (Synthetic)", () => {
    const raw = clone(bsbComplete2John3John)
    const copy = clone(raw.books[1])
    if (copy !== undefined) raw.books.push(copy)

    expect(normalizeTranslation(raw)).toEqual({
      status: "rejected",
      reason: "duplicate-book",
      bookId: "3JN",
    })
  })

  it("falls back to the English book name when the source has none (Synthetic)", () => {
    const raw = clone(bsbComplete2John3John.books[1]) as Record<string, unknown>
    raw.name = ""
    raw.commonName = " "
    raw.title = undefined

    const book = expectOk(normalizeBook(bsbComplete2John3John.translation, raw))
    expect(book.bookName).toBe("3 John")
  })
})

describe("parseBookText and parseChapterText", () => {
  it("reads back a stored per-book file unchanged", () => {
    const translation = expectOk(normalizeTranslation(bsbComplete2John3John))

    for (const book of translation.books) {
      const stored: unknown = JSON.parse(JSON.stringify(book))
      expect(expectOk(parseBookText(stored))).toEqual(book)
    }
  })

  it("reads back a stored chapter unchanged, merged ranges included", () => {
    const text = expectOk(normalizeChapterFile(t4tJohn4))
    const stored: unknown = JSON.parse(JSON.stringify(text))

    expect(expectOk(parseChapterText(stored))).toEqual(text)
  })

  it("refuses a file written in another format version", () => {
    const book = expectOk(normalizeTranslation(bsbComplete2John3John)).books[0]
    const stored = { ...book, formatVersion: BIBLE_TEXT_FORMAT_VERSION + 1 }

    expect(parseBookText(stored)).toEqual({
      status: "rejected",
      reason: "format-version",
    })
  })

  it.each([
    ["an empty verse", (verse: Record<string, unknown>) => (verse.lines = [])],
    [
      "a blank line",
      (verse: Record<string, unknown>) => (verse.lines = [{ text: " " }]),
    ],
    [
      "a range that ends before it starts",
      (verse: Record<string, unknown>) => (verse.through = 0),
    ],
    [
      "a verse number that is not an integer",
      (verse: Record<string, unknown>) => (verse.number = 1.5),
    ],
  ])("refuses a stored chapter with %s", (_name, damage) => {
    const text = JSON.parse(
      JSON.stringify(expectOk(normalizeChapterFile(bsbPsalm23))),
    ) as { chapter: { verses: Record<string, unknown>[] } }
    const verse = text.chapter.verses[0]
    if (verse !== undefined) damage(verse)

    expect(parseChapterText(text)).toMatchObject({
      status: "rejected",
      reason: "malformed-text",
    })
  })

  it("refuses stored verses that are out of order", () => {
    const text = JSON.parse(
      JSON.stringify(expectOk(normalizeChapterFile(bsbPsalm23))),
    ) as { chapter: { verses: unknown[] } }
    text.chapter.verses.reverse()

    expect(parseChapterText(text)).toMatchObject({
      status: "rejected",
      reason: "malformed-text",
    })
  })
})

describe("books", () => {
  it("lists the 66 books once each, 39 in the Old Testament", () => {
    expect(BIBLE_BOOKS).toHaveLength(66)
    expect(new Set(BIBLE_BOOKS.map((book) => book.usfm)).size).toBe(66)
    expect(new Set(BIBLE_BOOKS.map((book) => book.osis)).size).toBe(66)
    expect(BIBLE_BOOKS.filter((book) => book.testament === "old")).toHaveLength(
      39,
    )
    expect(BIBLE_BOOKS[0]?.usfm).toBe("GEN")
    expect(BIBLE_BOOKS[38]?.usfm).toBe("MAL")
    expect(BIBLE_BOOKS[39]?.usfm).toBe("MAT")
    expect(BIBLE_BOOKS[65]?.usfm).toBe("REV")
  })

  it("maps admin's OSIS ids to USFM ids", () => {
    expect(bookByOsis("Ps")?.usfm).toBe("PSA")
    expect(bookByOsis("Phlm")?.usfm).toBe("PHM")
    expect(bookByOsis("1Thess")?.usfm).toBe("1TH")
    expect(bookByOsis("Tob")).toBeUndefined()
  })

  it("looks up a book and its canon position by USFM id", () => {
    expect(bookByUsfm("SNG").name).toBe("Song of Solomon")
    expect(bookOrder("GEN")).toBe(0)
    expect(bookOrder("REV")).toBe(65)
    expect(isUsfmBookId("JHN")).toBe(true)
    expect(isUsfmBookId("TOB")).toBe(false)
    expect(isUsfmBookId("jhn")).toBe(false)
  })
})
