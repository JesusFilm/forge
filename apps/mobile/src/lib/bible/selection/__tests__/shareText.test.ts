// The text that Copy and Share send (feat-553 U9, R19, R42), over the bundled
// BSB books and the U1 fixtures: a gap (BSB MAT 18:11), poetry (BSB PSA 23),
// a merged range (T4T JHN 4:6-8), and Synodal numbers (SYN PSA 50).
import synodalPsalm50 from "../../text/__tests__/fixtures/rus_syn-psa-50.json"
import t4tJohn4 from "../../text/__tests__/fixtures/eng_t4t-jhn-4.json"
import { READER_COPY } from "../../reader/copy"
import { normalizeChapterFile, parseBookText } from "../../text/normalize"
import { chapterPositions } from "../../text/positions"
import type { UsfmBookId } from "../../text/books"
import type { ChapterPosition, ChapterText } from "../../text/types"
import { selectionChapterKey, tapStop, type VerseSelection } from "../selection"
import { shareText } from "../shareText"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")
const ASSETS = `${__dirname}/../../../../../assets/bible`

type Shown = { text: ChapterText; stops: ChapterPosition[] }

function bsb(book: UsfmBookId, number: number): Shown {
  const raw: unknown = JSON.parse(
    fs.readFileSync(`${ASSETS}/bsb/${book}.bible`, "utf8"),
  )
  const parsed = parseBookText(raw)
  if (parsed.status !== "ok") throw new Error(parsed.reason)
  const { chapters, ...header } = parsed.value
  const chapter = chapters.find((item) => item.number === number)
  if (!chapter) throw new Error(`no ${book} ${number}`)
  return { text: { ...header, chapter }, stops: chapterPositions(chapter) }
}

function fixture(raw: unknown): Shown {
  const result = normalizeChapterFile(raw)
  if (result.status !== "ok") throw new Error(result.reason)
  return {
    text: result.value,
    stops: chapterPositions(result.value.chapter),
  }
}

/** Taps the stops that start at each verse, in order. */
function select({ text, stops }: Shown, verses: number[]): VerseSelection {
  const key = selectionChapterKey({
    translationId: text.translationId,
    book: text.bookId,
    chapter: text.chapter.number,
  })
  const selection = verses.reduce<VerseSelection | null>((current, verse) => {
    const index = stops.findIndex((stop) =>
      stop.kind === "gap" ? stop.number === verse : stop.verse.number === verse,
    )
    return tapStop(current, stops, index, key)
  }, null)
  if (!selection) throw new Error("nothing selected")
  return selection
}

function share(shown: Shown, verses: number[], shortName: string): string {
  return shareText({
    bookName: shown.text.bookName,
    chapter: shown.text.chapter.number,
    shortName,
    stops: shown.stops,
    selection: select(shown, verses),
  })
}

describe("shareText (R19, R42)", () => {
  const john3 = bsb("JHN", 3)

  it("sends the verses, then John 3:16-17 · BSB", () => {
    expect(share(john3, [16, 17], "BSB")).toBe(
      "16 For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life. " +
        "17 For God did not send His Son into the world to condemn the world, but to save the world through Him." +
        "\n\nJohn 3:16-17 · BSB",
    )
  })

  it("sends one verse with no verse number in front of it", () => {
    expect(share(john3, [16], "BSB")).toBe(
      "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life." +
        "\n\nJohn 3:16 · BSB",
    )
  })

  it("leaves out the Matthew 18:11 note but keeps the reference whole (R21)", () => {
    const text = share(bsb("MAT", 18), [10, 12], "BSB")
    expect(text).not.toContain(READER_COPY.missingVerse(11))
    expect(text).not.toMatch(/(^|\s)11 /)
    expect(text.startsWith("10 See that you do not look down")).toBe(true)
    expect(text).toContain(" 12 What do you think?")
    expect(text.endsWith("\n\nMatthew 18:10-12 · BSB")).toBe(true)
  })

  it("keeps each poetry line on its own line", () => {
    expect(share(bsb("PSA", 23), [1, 2], "BSB")).toBe(
      "1 The LORD is my shepherd;\nI shall not want.\n" +
        "2 He makes me lie down in green pastures;\nHe leads me beside quiet waters." +
        "\n\nPsalms 23:1-2 · BSB",
    )
  })

  it("sends a merged range as one stop: T4T John 4:6-8", () => {
    const text = share(fixture(t4tJohn4), [6], "T4T")
    expect(text.startsWith("The well that used to belong to Jacob")).toBe(true)
    expect(text.endsWith("\n\nJohn 4:6-8 · T4T")).toBe(true)
  })

  it("covers AE17: a Synodal selection sends Synodal numbers, not BSB ones", () => {
    const psalm50 = fixture(synodalPsalm50)
    const text = share(psalm50, [1, 2, 3], "SYN")
    const bookName = psalm50.text.bookName
    // BSB numbers this passage Psalm 51, with the title outside the verses.
    expect(text.endsWith(`\n\n${bookName} 50:1-3 · SYN`)).toBe(true)
    expect(text).not.toContain("51")
    expect(text.startsWith("1 Начальнику хора. Псалом Давида,")).toBe(true)
    expect(text).toContain("\n2 когда приходил к нему пророк Нафан")
    expect(text).toContain("\n3 Помилуй меня, Боже")
  })
})
