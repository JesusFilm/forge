// The verse selection rules (feat-553 U9, R19, R42) over real stops: the
// bundled BSB books and the U1 fixtures, so a gap (BSB MAT 18:11) and a merged
// range (T4T JHN 4:6-8) keep their production shapes.
import t4tJohn4 from "../../text/__tests__/fixtures/eng_t4t-jhn-4.json"
import { normalizeChapterFile, parseBookText } from "../../text/normalize"
import { chapterPositions } from "../../text/positions"
import type { UsfmBookId } from "../../text/books"
import type { Chapter, ChapterPosition } from "../../text/types"
import {
  isStopSelected,
  selectionChapterKey,
  selectionReference,
  tapStop,
  type VerseSelection,
} from "../selection"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")
const ASSETS = `${__dirname}/../../../../../assets/bible`

function bsbChapter(book: UsfmBookId, number: number): Chapter {
  const raw: unknown = JSON.parse(
    fs.readFileSync(`${ASSETS}/bsb/${book}.bible`, "utf8"),
  )
  const parsed = parseBookText(raw)
  if (parsed.status !== "ok") throw new Error(parsed.reason)
  const chapter = parsed.value.chapters.find((item) => item.number === number)
  if (!chapter) throw new Error(`no ${book} ${number}`)
  return chapter
}

function t4tChapter(): Chapter {
  const result = normalizeChapterFile(t4tJohn4)
  if (result.status !== "ok") throw new Error(result.reason)
  return result.value.chapter
}

const JOHN_3 = chapterPositions(bsbChapter("JHN", 3))
const MATTHEW_18 = chapterPositions(bsbChapter("MAT", 18))
const T4T_JOHN_4 = chapterPositions(t4tChapter())

const JOHN_3_KEY = selectionChapterKey({
  translationId: "BSB",
  book: "JHN",
  chapter: 3,
})

/** The stop that starts at `verse`. */
function indexOf(stops: readonly ChapterPosition[], verse: number): number {
  const index = stops.findIndex((stop) =>
    stop.kind === "gap" ? stop.number === verse : stop.verse.number === verse,
  )
  if (index === -1) throw new Error(`no stop at ${verse}`)
  return index
}

/** Taps the stops that start at each verse, in order. */
function taps(
  stops: readonly ChapterPosition[],
  verses: number[],
  key = JOHN_3_KEY,
  from: VerseSelection | null = null,
): VerseSelection | null {
  return verses.reduce<VerseSelection | null>(
    (selection, verse) => tapStop(selection, stops, indexOf(stops, verse), key),
    from,
  )
}

function range(selection: VerseSelection | null) {
  return selection && { first: selection.first, last: selection.last }
}

describe("tapStop (R19)", () => {
  it("selects the tapped verse", () => {
    expect(taps(JOHN_3, [16])).toEqual({
      chapterKey: JOHN_3_KEY,
      first: 16,
      last: 16,
    })
  })

  it("extends the selection by the next verse: 3:16 then 3:17 is 3:16-17", () => {
    expect(range(taps(JOHN_3, [16, 17]))).toEqual({ first: 16, last: 17 })
  })

  it("extends the selection by the previous verse", () => {
    expect(range(taps(JOHN_3, [17, 16]))).toEqual({ first: 16, last: 17 })
  })

  it("starts a new selection at a verse that is not next to it: 3:16 then 3:18", () => {
    expect(range(taps(JOHN_3, [16, 18]))).toEqual({ first: 18, last: 18 })
    expect(range(taps(JOHN_3, [18, 16]))).toEqual({ first: 16, last: 16 })
  })

  it("cuts 3:16-18 to 3:16 when 3:17 is removed", () => {
    expect(range(taps(JOHN_3, [16, 17, 18, 17]))).toEqual({
      first: 16,
      last: 16,
    })
  })

  it("keeps the rest of the range when its first or last verse is removed", () => {
    expect(range(taps(JOHN_3, [16, 17, 18, 16]))).toEqual({
      first: 17,
      last: 18,
    })
    expect(range(taps(JOHN_3, [16, 17, 18, 18]))).toEqual({
      first: 16,
      last: 17,
    })
  })

  it("clears the selection when its only verse is removed", () => {
    expect(taps(JOHN_3, [16, 16])).toBeNull()
  })

  it("never selects a gap stop, and a tap on one keeps the selection", () => {
    expect(taps(MATTHEW_18, [11])).toBeNull()
    const selected = taps(MATTHEW_18, [10])
    expect(taps(MATTHEW_18, [11], JOHN_3_KEY, selected)).toBe(selected)
  })

  it("extends over a gap, because the gap sits between two neighbor verses", () => {
    expect(range(taps(MATTHEW_18, [10, 12]))).toEqual({ first: 10, last: 12 })
    expect(range(taps(MATTHEW_18, [12, 10]))).toEqual({ first: 10, last: 12 })
  })

  it("never leaves a gap at an end of the selection", () => {
    expect(range(taps(MATTHEW_18, [10, 12, 10]))).toEqual({
      first: 12,
      last: 12,
    })
    expect(range(taps(MATTHEW_18, [10, 12, 12]))).toEqual({
      first: 10,
      last: 10,
    })
  })

  it("selects a merged range as one stop: T4T John 4:6-8", () => {
    expect(range(taps(T4T_JOHN_4, [6]))).toEqual({ first: 6, last: 8 })
    expect(range(taps(T4T_JOHN_4, [6, 9]))).toEqual({ first: 6, last: 9 })
    expect(range(taps(T4T_JOHN_4, [5, 6]))).toEqual({ first: 5, last: 8 })
    expect(taps(T4T_JOHN_4, [6, 6])).toBeNull()
  })

  it("ignores a selection from another chapter or translation", () => {
    const john4 = selectionChapterKey({
      translationId: "BSB",
      book: "JHN",
      chapter: 4,
    })
    const stale = taps(JOHN_3, [16], john4)
    expect(taps(JOHN_3, [17], JOHN_3_KEY, stale)).toEqual({
      chapterKey: JOHN_3_KEY,
      first: 17,
      last: 17,
    })
  })
})

describe("selectionChapterKey", () => {
  it("differs by translation, book, and chapter", () => {
    const keys = new Set([
      JOHN_3_KEY,
      selectionChapterKey({
        translationId: "eng_t4t",
        book: "JHN",
        chapter: 3,
      }),
      selectionChapterKey({ translationId: "BSB", book: "ACT", chapter: 3 }),
      selectionChapterKey({ translationId: "BSB", book: "JHN", chapter: 4 }),
    ])
    expect(keys.size).toBe(4)
  })
})

describe("isStopSelected", () => {
  it("marks each verse stop inside the selection, and no gap stop", () => {
    const selection = taps(MATTHEW_18, [10, 12])
    const marked = MATTHEW_18.map((_, index) =>
      isStopSelected(selection, MATTHEW_18, index),
    )
    expect(marked.filter(Boolean)).toHaveLength(2)
    expect(marked[indexOf(MATTHEW_18, 10)]).toBe(true)
    expect(marked[indexOf(MATTHEW_18, 11)]).toBe(false)
    expect(marked[indexOf(MATTHEW_18, 12)]).toBe(true)
    expect(isStopSelected(null, MATTHEW_18, 0)).toBe(false)
  })
})

describe("selectionReference (R42)", () => {
  it("names one verse, a range, and a merged range", () => {
    expect(selectionReference("John", 3, taps(JOHN_3, [16])!)).toBe("John 3:16")
    expect(selectionReference("John", 3, taps(JOHN_3, [16, 17])!)).toBe(
      "John 3:16-17",
    )
    expect(selectionReference("John", 4, taps(T4T_JOHN_4, [6])!)).toBe(
      "John 4:6-8",
    )
  })
})
