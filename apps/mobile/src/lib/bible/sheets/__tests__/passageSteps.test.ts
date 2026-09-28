/**
 * The passage picker's three steps (feat-553 U10, R17, R42): books, then
 * chapters and verses in the shown translation's own numbers, then the pick
 * back in BSB numbering for the saved position (R38).
 */
import { BIBLE_BOOKS, type UsfmBookId } from "../../text/books"
import {
  chapterNumbers,
  numberingFor,
  passageBooks,
  pickedBsbRef,
  pickerCurrent,
  verseNumbers,
} from "../passageSteps"

const ALL_BOOKS: ReadonlySet<UsfmBookId> = new Set(
  BIBLE_BOOKS.map((book) => book.usfm),
)
const NEW_TESTAMENT: ReadonlySet<UsfmBookId> = new Set(
  BIBLE_BOOKS.filter((book) => book.testament === "new").map(
    (book) => book.usfm,
  ),
)

describe("passageBooks", () => {
  it("lists all 66 books in canon order", () => {
    const books = passageBooks({ id: "BSB", books: ALL_BOOKS })
    expect(books.map((entry) => entry.book.usfm)).toEqual(
      BIBLE_BOOKS.map((book) => book.usfm),
    )
    expect(books.every((entry) => entry.inTranslation)).toBe(true)
  })

  it("keeps a book the translation lacks, marked for the R25 fallback", () => {
    const books = passageBooks({ id: "xyz_nt", books: NEW_TESTAMENT })
    expect(books).toHaveLength(66)
    expect(
      books.find((entry) => entry.book.usfm === "GEN")?.inTranslation,
    ).toBe(false)
    expect(
      books.find((entry) => entry.book.usfm === "MAT")?.inTranslation,
    ).toBe(true)
  })

  it("reads no translation as BSB", () => {
    expect(passageBooks(null).every((entry) => entry.inTranslation)).toBe(true)
  })
})

describe("numberingFor", () => {
  it("uses the translation's numbers for a book it has, else BSB's", () => {
    const nt = { id: "xyz_nt", books: NEW_TESTAMENT }
    expect(numberingFor(nt, "MAT")).toBe("xyz_nt")
    expect(numberingFor(nt, "GEN")).toBe("BSB")
    expect(numberingFor(null, "GEN")).toBe("BSB")
  })
})

describe("chapterNumbers and verseNumbers", () => {
  it("counts BSB chapters and verses", () => {
    expect(chapterNumbers("BSB", "PSA")).toHaveLength(150)
    expect(chapterNumbers("BSB", "JOL")).toEqual([1, 2, 3])
    expect(verseNumbers("BSB", "JHN", 3)).toHaveLength(36)
    // BSB leaves out Matthew 18:11, but the numbers still run to 35 (AE9).
    expect(verseNumbers("BSB", "MAT", 18)).toHaveLength(35)
  })

  it("counts in the translation's own numbering (R42)", () => {
    // HBOMAS numbers Joel the Hebrew way, with four chapters.
    expect(chapterNumbers("HBOMAS", "JOL")).toEqual([1, 2, 3, 4])
    // Synodal counts the Psalm 51 title as two verses (AE17).
    expect(verseNumbers("rus_syn", "PSA", 50)).toHaveLength(21)
    expect(verseNumbers("BSB", "PSA", 51)).toHaveLength(19)
  })

  it("gives no verses for a chapter the numbering lacks", () => {
    expect(verseNumbers("BSB", "JOL", 4)).toEqual([])
    expect(verseNumbers("BSB", "JHN", 0)).toEqual([])
  })
})

describe("pickedBsbRef", () => {
  it("turns a Synodal pick into the BSB position (AE11, AE17)", () => {
    expect(
      pickedBsbRef("rus_syn", { book: "PSA", chapter: 22, verse: 1 }),
    ).toEqual({ book: "PSA", chapter: 23, verse: 1 })
    expect(
      pickedBsbRef("rus_syn", { book: "PSA", chapter: 50, verse: 3 }),
    ).toEqual({ book: "PSA", chapter: 51, verse: 1 })
  })

  it("keeps a BSB pick as it is", () => {
    expect(pickedBsbRef("BSB", { book: "JHN", chapter: 3, verse: 16 })).toEqual(
      { book: "JHN", chapter: 3, verse: 16 },
    )
  })
})

// R25's stand-in: the picker follows the viewer's pick (owner, 2026-09-28).
describe("pickerCurrent", () => {
  const SYNODAL = { id: "rus_syn", books: ALL_BOOKS }
  const BSB_PSALM_23_1 = { book: "PSA" as const, chapter: 23, verse: 1 }
  const SYNODAL_PSALM_22_1 = { book: "PSA" as const, chapter: 22, verse: 1 }

  it("marks the shown verse when the pick is what shows", () => {
    expect(
      pickerCurrent({
        translation: SYNODAL,
        ref: BSB_PSALM_23_1,
        shownRef: SYNODAL_PSALM_22_1,
        standIn: false,
      }),
    ).toEqual(SYNODAL_PSALM_22_1)
  })

  it("marks the BSB verse with no translation", () => {
    expect(
      pickerCurrent({
        translation: null,
        ref: BSB_PSALM_23_1,
        shownRef: SYNODAL_PSALM_22_1,
        standIn: false,
      }),
    ).toEqual(BSB_PSALM_23_1)
  })

  it("puts the verse in the pick's numbers while a stand-in shows", () => {
    // The pick has Psalms: BSB Psalm 23 is Synodal Psalm 22.
    expect(
      pickerCurrent({
        translation: SYNODAL,
        ref: BSB_PSALM_23_1,
        shownRef: BSB_PSALM_23_1,
        standIn: true,
      }),
    ).toEqual(SYNODAL_PSALM_22_1)
    // The pick lacks the book, so the picker uses BSB's numbers for it.
    expect(
      pickerCurrent({
        translation: { id: "xyz_nt", books: NEW_TESTAMENT },
        ref: BSB_PSALM_23_1,
        shownRef: SYNODAL_PSALM_22_1,
        standIn: true,
      }),
    ).toEqual(BSB_PSALM_23_1)
  })
})
