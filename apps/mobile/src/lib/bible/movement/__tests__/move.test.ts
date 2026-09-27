// The KTD19 move over real stops: the bundled BSB books and the U1 fixtures,
// so a gap (BSB MAT 18:11) and a merged range (T4T JHN 4:6-8) keep their
// production shapes.
import t4tJohn4 from "../../text/__tests__/fixtures/eng_t4t-jhn-4.json"
import { parseBookText, normalizeChapterFile } from "../../text/normalize"
import { chapterPositions } from "../../text/positions"
import type { UsfmBookId } from "../../text/books"
import type { Chapter, ChapterPosition } from "../../text/types"
import {
  BSB_NUMBERING,
  moveChapter,
  moveVerse,
  neighborChapter,
  systemNumbering,
  type MoveDirection,
  type MoveResult,
} from "../move"

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

/** The stop that starts at `verse`. */
function indexOf(stops: readonly ChapterPosition[], verse: number): number {
  const index = stops.findIndex((stop) =>
    stop.kind === "gap" ? stop.number === verse : stop.verse.number === verse,
  )
  if (index === -1) throw new Error(`no stop at ${verse}`)
  return index
}

function verseMove(
  book: UsfmBookId,
  chapter: Chapter,
  verse: number,
  direction: MoveDirection,
): MoveResult {
  const stops = chapterPositions(chapter)
  return moveVerse({
    book,
    chapter: chapter.number,
    stops,
    stopIndex: indexOf(stops, verse),
    direction,
    numbering: BSB_NUMBERING,
  })
}

describe("moveVerse (KTD19, R14)", () => {
  it("covers AE8: John 3:36 forward opens John 4:1 with a chapter change", () => {
    expect(verseMove("JHN", bsbChapter("JHN", 3), 36, "forward")).toEqual({
      kind: "chapter",
      target: {
        ref: { book: "JHN", chapter: 4, verse: 1 },
        numbering: "shown",
      },
    })
  })

  it("covers AE8: Revelation 22:21 forward stops at the end of the Bible", () => {
    expect(verseMove("REV", bsbChapter("REV", 22), 21, "forward")).toEqual({
      kind: "stop",
      edge: "end",
    })
  })

  it("stops at Genesis 1:1 going back", () => {
    expect(verseMove("GEN", bsbChapter("GEN", 1), 1, "back")).toEqual({
      kind: "stop",
      edge: "start",
    })
  })

  it("moves back from John 4:1 to John 3:36, the last verse", () => {
    expect(verseMove("JHN", bsbChapter("JHN", 4), 1, "back")).toEqual({
      kind: "chapter",
      target: {
        ref: { book: "JHN", chapter: 3, verse: 36 },
        numbering: "shown",
      },
    })
  })

  it("stays in the chapter for a neighbor verse", () => {
    const chapter = bsbChapter("JHN", 3)
    const stops = chapterPositions(chapter)
    const result = verseMove("JHN", chapter, 16, "forward")
    expect(result).toEqual({
      kind: "verse",
      stopIndex: indexOf(stops, 17),
      ref: { book: "JHN", chapter: 3, verse: 17 },
    })
  })

  it("passes through a gap verse: Matthew 18:10, the 18:11 note, then 18:12", () => {
    const chapter = bsbChapter("MAT", 18)
    const stops = chapterPositions(chapter)
    const toGap = verseMove("MAT", chapter, 10, "forward")
    expect(toGap).toEqual({
      kind: "verse",
      stopIndex: indexOf(stops, 11),
      ref: { book: "MAT", chapter: 18, verse: 11 },
    })
    expect(stops[indexOf(stops, 11)]).toEqual({ kind: "gap", number: 11 })
    expect(verseMove("MAT", chapter, 11, "forward")).toMatchObject({
      kind: "verse",
      ref: { verse: 12 },
    })
    expect(verseMove("MAT", chapter, 12, "back")).toMatchObject({
      kind: "verse",
      ref: { verse: 11 },
    })
  })

  it("moves over a merged range in one move: T4T John 4:5, 4:6-8, then 4:9", () => {
    const chapter = t4tChapter()
    const stops = chapterPositions(chapter)
    const merged = verseMove("JHN", chapter, 5, "forward")
    expect(merged).toEqual({
      kind: "verse",
      stopIndex: indexOf(stops, 6),
      ref: { book: "JHN", chapter: 4, verse: 6 },
    })
    expect(stops[indexOf(stops, 6)]).toMatchObject({
      kind: "verse",
      verse: { number: 6, through: 8 },
    })
    expect(verseMove("JHN", chapter, 6, "forward")).toMatchObject({
      kind: "verse",
      ref: { verse: 9 },
    })
    expect(verseMove("JHN", chapter, 9, "back")).toMatchObject({
      kind: "verse",
      ref: { verse: 6 },
    })
  })

  it("crosses a book boundary in canon order, in BSB numbers", () => {
    expect(verseMove("MAL", bsbChapter("MAL", 4), 6, "forward")).toEqual({
      kind: "chapter",
      target: { ref: { book: "MAT", chapter: 1, verse: 1 }, numbering: "bsb" },
    })
    expect(verseMove("MAT", bsbChapter("MAT", 1), 1, "back")).toEqual({
      kind: "chapter",
      target: { ref: { book: "MAL", chapter: 4, verse: 6 }, numbering: "bsb" },
    })
  })

  it("reads the shown numbering inside a book: Synodal Psalm 50 back lands on 49's last verse", () => {
    const synodal = systemNumbering("rsc")
    const stops: ChapterPosition[] = [
      { kind: "verse", verse: { number: 1, lines: [{ text: "title" }] } },
    ]
    const result = moveVerse({
      book: "PSA",
      chapter: 50,
      stops,
      stopIndex: 0,
      direction: "back",
      numbering: synodal,
    })
    expect(result).toEqual({
      kind: "chapter",
      target: {
        ref: { book: "PSA", chapter: 49, verse: synodal("PSA", 49) },
        numbering: "shown",
      },
    })
    // Synodal Psalm 49 is BSB Psalm 50, so a BSB count would differ.
    expect(synodal("PSA", 49)).not.toBe(BSB_NUMBERING("PSA", 49))
  })
})

describe("moveChapter (R12, R13)", () => {
  it("opens verse 1 of the next and the previous chapter", () => {
    const move = (direction: MoveDirection) =>
      moveChapter({
        book: "JHN",
        chapter: 3,
        direction,
        numbering: BSB_NUMBERING,
      })
    expect(move("forward")).toEqual({
      kind: "chapter",
      target: {
        ref: { book: "JHN", chapter: 4, verse: 1 },
        numbering: "shown",
      },
    })
    expect(move("back")).toEqual({
      kind: "chapter",
      target: {
        ref: { book: "JHN", chapter: 2, verse: 1 },
        numbering: "shown",
      },
    })
  })

  it("stops at the first and the last chapter of the Bible", () => {
    expect(
      moveChapter({
        book: "GEN",
        chapter: 1,
        direction: "back",
        numbering: BSB_NUMBERING,
      }),
    ).toEqual({ kind: "stop", edge: "start" })
    expect(
      moveChapter({
        book: "REV",
        chapter: 22,
        direction: "forward",
        numbering: BSB_NUMBERING,
      }),
    ).toEqual({ kind: "stop", edge: "end" })
  })

  it("opens verse 1 of the previous book's last chapter", () => {
    expect(
      moveChapter({
        book: "MAT",
        chapter: 1,
        direction: "back",
        numbering: BSB_NUMBERING,
      }),
    ).toEqual({
      kind: "chapter",
      target: { ref: { book: "MAL", chapter: 4, verse: 1 }, numbering: "bsb" },
    })
  })
})

describe("neighborChapter (R13's destination label)", () => {
  it("names the chapter a swipe opens, or null at a Bible end", () => {
    expect(neighborChapter("JHN", 3, "forward", BSB_NUMBERING)).toEqual({
      book: "JHN",
      chapter: 4,
    })
    expect(neighborChapter("PSA", 150, "forward", BSB_NUMBERING)).toEqual({
      book: "PRO",
      chapter: 1,
    })
    expect(neighborChapter("GEN", 1, "back", BSB_NUMBERING)).toBeNull()
    expect(neighborChapter("REV", 22, "forward", BSB_NUMBERING)).toBeNull()
  })
})
