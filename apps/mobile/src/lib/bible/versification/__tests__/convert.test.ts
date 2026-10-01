// chapter-lengths.json holds the highest verse number of every chapter, taken
// from each translation's real bible.helloao.org complete.json on 2026-09-25
// (BSB complete.json sha256 91fa1045…227e).
import chapterLengths from "./fixtures/chapter-lengths.json"
import { BIBLE_BOOKS, type UsfmBookId } from "../../text/books"
import {
  VERSIFICATION_SYSTEM_IDS,
  convertVerse,
  fromBsb,
  isVersificationSystemId,
  mappedLastVerse,
  toBsb,
  type VerseRef,
} from "../convert"

const BSB_LENGTHS: Record<string, number[]> = chapterLengths.translations.BSB

function ref(book: UsfmBookId, chapter: number, verse: number): VerseRef {
  return { book, chapter, verse }
}

function bsbVerses(book: UsfmBookId, chapters?: number): VerseRef[] {
  const lengths = BSB_LENGTHS[book] ?? []
  const refs: VerseRef[] = []
  lengths.slice(0, chapters).forEach((last, index) => {
    for (let verse = 1; verse <= last; verse += 1) {
      refs.push(ref(book, index + 1, verse))
    }
  })
  return refs
}

describe("fromBsb and toBsb", () => {
  it("AE11: BSB Psalm 23:1 opens Synodal (rsc) Psalm 22:1", () => {
    expect(fromBsb(ref("PSA", 23, 1), "rsc")).toEqual(ref("PSA", 22, 1))
  })

  it("AE17: BSB Psalm 51:1 opens rsc Psalm 50:3, after the two title verses", () => {
    expect(fromBsb(ref("PSA", 51, 1), "rsc")).toEqual(ref("PSA", 50, 3))
  })

  it("AE17: rsc Psalm 50:1 and 50:2 (the title) save as BSB Psalm 51:1", () => {
    expect(toBsb(ref("PSA", 50, 1), "rsc")).toEqual(ref("PSA", 51, 1))
    expect(toBsb(ref("PSA", 50, 2), "rsc")).toEqual(ref("PSA", 51, 1))
    expect(toBsb(ref("PSA", 50, 3), "rsc")).toEqual(ref("PSA", 51, 1))
  })

  it("rsc Romans 14:24 saves as BSB Romans 16:25, and back", () => {
    expect(toBsb(ref("ROM", 14, 24), "rsc")).toEqual(ref("ROM", 16, 25))
    expect(toBsb(ref("ROM", 14, 26), "rsc")).toEqual(ref("ROM", 16, 27))
    expect(fromBsb(ref("ROM", 16, 25), "rsc")).toEqual(ref("ROM", 14, 24))
  })

  it("BSB Daniel 4:1 opens rsc Daniel 3:31; rso would give 3:98", () => {
    expect(fromBsb(ref("DAN", 4, 1), "rsc")).toEqual(ref("DAN", 3, 31))
    expect(fromBsb(ref("DAN", 4, 1), "rso")).toEqual(ref("DAN", 3, 98))
    expect(mappedLastVerse("rsc", "DAN", 3)).toBe(33)
  })

  it("keeps the numbers in a book that both systems number the same way", () => {
    expect(fromBsb(ref("GAL", 2, 20), "rsc")).toEqual(ref("GAL", 2, 20))
    expect(toBsb(ref("GAL", 2, 20), "vul")).toEqual(ref("GAL", 2, 20))
  })

  it("keeps the numbers when the target system has no mapping for the book", () => {
    // lxx has no DAN entry: it numbers Greek Daniel as the DAG book.
    expect(fromBsb(ref("DAN", 4, 1), "lxx")).toEqual(ref("DAN", 4, 1))
    expect(toBsb(ref("DAN", 4, 1), "lxx")).toEqual(ref("DAN", 4, 1))
  })

  it("round-trips every BSB verse in Psalms 1-10 through rsc", () => {
    const verses = bsbVerses("PSA", 10)
    expect(verses).toHaveLength(120)
    let moved = 0
    for (const verse of verses) {
      const inRsc = fromBsb(verse, "rsc")
      if (inRsc.chapter !== verse.chapter || inRsc.verse !== verse.verse) {
        moved += 1
      }
      expect(toBsb(inRsc, "rsc")).toEqual(verse)
    }
    // Psalms 3-9 gain a title verse, and Psalm 10 becomes rsc 9:22-39.
    expect(moved).toBe(102)
  })

  it("an explicit mapping beats the same number", () => {
    // eng maps 7:69 to org Nehemiah 7:68, so org 7:68 is BSB 7:69, not 7:68.
    expect(toBsb(ref("NEH", 7, 68), "org")).toEqual(ref("NEH", 7, 69))
    expect(toBsb(ref("ISA", 64, 1), "org")).toEqual(ref("ISA", 64, 2))
    expect(fromBsb(ref("ISA", 64, 2), "org")).toEqual(ref("ISA", 64, 1))
  })

  it("follows the eng erratum: BSB Isaiah 64:1 is org 63:19", () => {
    expect(fromBsb(ref("ISA", 64, 1), "org")).toEqual(ref("ISA", 63, 19))
    expect(toBsb(ref("ISA", 63, 19), "org")).toEqual(ref("ISA", 63, 19))
  })

  it("pairs a many-to-one mapping verse by verse", () => {
    // BSB and rsc both split org Isaiah 63:19 into 63:19 and 64:1.
    expect(fromBsb(ref("ISA", 63, 19), "rsc")).toEqual(ref("ISA", 63, 19))
    expect(fromBsb(ref("ISA", 64, 1), "rsc")).toEqual(ref("ISA", 64, 1))
    expect(toBsb(ref("ISA", 64, 1), "rsc")).toEqual(ref("ISA", 64, 1))
    expect(toBsb(ref("ISA", 64, 2), "rsc")).toEqual(ref("ISA", 64, 2))
  })

  it("maps BSB to eng and back unchanged for every BSB verse", () => {
    for (const book of BIBLE_BOOKS) {
      for (const verse of bsbVerses(book.usfm)) {
        const inEng = fromBsb(verse, "eng")
        expect(inEng).toEqual(verse)
        expect(toBsb(inEng, "eng")).toEqual(verse)
      }
    }
  })

  it("anchors a verse with no counterpart to the next mapped verse (R38)", () => {
    // org ends Acts 19 at verse 40, so BSB 19:41 opens org 20:1.
    expect(fromBsb(ref("ACT", 19, 41), "org")).toEqual(ref("ACT", 20, 1))
    // A Psalm title has no BSB verse, so it saves as the first BSB verse.
    expect(toBsb(ref("PSA", 3, 1), "rsc")).toEqual(ref("PSA", 3, 1))
    expect(toBsb(ref("PSA", 3, 2), "rsc")).toEqual(ref("PSA", 3, 1))
  })

  it("anchors to the previous mapped verse at the end of a book", () => {
    // eng splits 2 Corinthians 13:12, so eng has 13:14 and org ends at 13:13.
    expect(fromBsb(ref("2CO", 13, 14), "org")).toEqual(ref("2CO", 13, 13))
  })

  it("saves a verse that maps out of the book as the next verse with a BSB counterpart", () => {
    // rso numbers the Greek addition as Daniel 3:24-90 (the DAG book in org).
    expect(toBsb(ref("DAN", 3, 50), "rso")).toEqual(ref("DAN", 3, 24))
    expect(toBsb(ref("DAN", 3, 91), "rso")).toEqual(ref("DAN", 3, 24))
  })
})

describe("convertVerse", () => {
  it("converts between two translation systems through org", () => {
    expect(convertVerse(ref("PSA", 22, 1), "rsc", "org")).toEqual(
      ref("PSA", 23, 1),
    )
    expect(convertVerse(ref("PSA", 50, 3), "rsc", "eng")).toEqual(
      ref("PSA", 51, 1),
    )
  })

  it("returns a malformed reference unchanged", () => {
    for (const bad of [
      ref("PSA", 0, 1),
      ref("PSA", 51, 1000),
      ref("PSA", 51, 1.5),
      ref("PSA", Number.NaN, 1),
    ]) {
      expect(convertVerse(bad, "bsb", "rsc")).toBe(bad)
    }
  })

  it("returns the same reference when the systems are the same", () => {
    expect(convertVerse(ref("PSA", 50, 1), "rsc", "rsc")).toEqual(
      ref("PSA", 50, 1),
    )
  })
})

describe("BSB numbering compared with eng (Outstanding Questions)", () => {
  function engLengths(book: UsfmBookId): (number | undefined)[] {
    const lengths = BSB_LENGTHS[book] ?? []
    return lengths.map((_, index) => mappedLastVerse("eng", book, index + 1))
  }

  it("Malachi and Joel: BSB has eng's chapters and chapter lengths", () => {
    expect(BSB_LENGTHS.MAL).toEqual([14, 17, 18, 6])
    expect(engLengths("MAL")).toEqual(BSB_LENGTHS.MAL)
    expect(BSB_LENGTHS.JOL).toEqual([20, 32, 21])
    expect(engLengths("JOL")).toEqual(BSB_LENGTHS.JOL)
  })

  it("Malachi and Joel: BSB references go to org as eng's do", () => {
    expect(convertVerse(ref("MAL", 4, 1), "bsb", "org")).toEqual(
      ref("MAL", 3, 19),
    )
    expect(convertVerse(ref("JOL", 2, 28), "bsb", "org")).toEqual(
      ref("JOL", 3, 1),
    )
    expect(convertVerse(ref("JOL", 3, 1), "bsb", "org")).toEqual(
      ref("JOL", 4, 1),
    )
  })

  it("3 John: BSB ends at verse 14, where eng has a verse 15", () => {
    expect(BSB_LENGTHS["3JN"]).toEqual([14])
    expect(mappedLastVerse("eng", "3JN", 1)).toBe(15)
    expect(mappedLastVerse("bsb", "3JN", 1)).toBe(14)
    expect(toBsb(ref("3JN", 1, 15), "eng")).toEqual(ref("3JN", 1, 14))
  })

  it("Revelation 12: BSB ends at verse 17, where eng has a verse 18", () => {
    const bsbRevelation = BSB_LENGTHS.REV ?? []
    const engRevelation = engLengths("REV")
    expect(bsbRevelation[11]).toBe(17)
    expect(engRevelation[11]).toBe(18)
    expect(bsbRevelation.filter((n, i) => n !== engRevelation[i])).toEqual([17])
    expect(toBsb(ref("REV", 12, 18), "eng")).toEqual(ref("REV", 12, 17))
    expect(toBsb(ref("REV", 13, 1), "rsc")).toEqual(ref("REV", 13, 1))
  })

  it("the bsb system has BSB's real chapter lengths in all 66 books", () => {
    for (const book of BIBLE_BOOKS) {
      const lengths = BSB_LENGTHS[book.usfm] ?? []
      expect(lengths.length).toBeGreaterThan(0)
      const mapped = lengths.map((_, index) =>
        mappedLastVerse("bsb", book.usfm, index + 1),
      )
      expect(mapped).toEqual(lengths)
      expect(mappedLastVerse("bsb", book.usfm, lengths.length + 1)).toBe(
        undefined,
      )
    }
  })
})

describe("isVersificationSystemId", () => {
  it("accepts bsb and the six standard systems only", () => {
    expect(VERSIFICATION_SYSTEM_IDS).toEqual([
      "bsb",
      "org",
      "eng",
      "lxx",
      "vul",
      "rsc",
      "rso",
    ])
    expect(isVersificationSystemId("rsc")).toBe(true)
    expect(isVersificationSystemId("bsb")).toBe(true)
    expect(isVersificationSystemId("unknown")).toBe(false)
    expect(isVersificationSystemId("RSC")).toBe(false)
  })
})

describe("mappedLastVerse", () => {
  it("gives each system's last verse for a chapter", () => {
    expect(mappedLastVerse("rsc", "PSA", 50)).toBe(21)
    expect(mappedLastVerse("eng", "PSA", 51)).toBe(19)
    expect(mappedLastVerse("org", "PSA", 51)).toBe(21)
  })

  it("gives undefined for a chapter or book the system does not have", () => {
    expect(mappedLastVerse("eng", "MAL", 5)).toBeUndefined()
    expect(mappedLastVerse("eng", "MAL", 0)).toBeUndefined()
    expect(mappedLastVerse("lxx", "DAN", 1)).toBeUndefined()
  })
})
