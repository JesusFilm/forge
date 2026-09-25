// The reader's labels (feat-551 R9, R21, R25, R41, R42, KTD19). The chapters
// are U1's real bible.helloao.org fixtures, normalized as the app reads them.
import bsbMatthew18 from "../../text/__tests__/fixtures/bsb-mat-18.json"
import t4tJohn4 from "../../text/__tests__/fixtures/eng_t4t-jhn-4.json"
import type { CatalogTranslation } from "../../data/catalog"
import type { ShownTranslation } from "../../language/defaultTranslation"
import { normalizeChapterFile } from "../../text/normalize"
import { chapterPositions } from "../../text/positions"
import type { Chapter, ChapterPosition } from "../../text/types"
import { READER_COPY } from "../copy"
import {
  chapterLabel,
  chapterProgress,
  counterAccessibilityLabel,
  counterLabel,
  passageLabel,
  stopIndexForVerse,
  translationLabel,
  verseRangeLabel,
} from "../labels"

function chapterOf(raw: unknown): Chapter {
  const result = normalizeChapterFile(raw)
  if (result.status !== "ok") throw new TypeError(result.reason)
  return result.value.chapter
}

const matthew18 = chapterOf(bsbMatthew18)
const t4tJohn4Chapter = chapterOf(t4tJohn4)

function stopAt(chapter: Chapter, verse: number): ChapterPosition {
  const positions = chapterPositions(chapter)
  const stop = positions[stopIndexForVerse(positions, verse)]
  if (!stop) throw new TypeError(`no stop for verse ${verse}`)
  return stop
}

function translation(
  overrides: Partial<CatalogTranslation> = {},
): CatalogTranslation {
  return {
    id: "BSB",
    language: "eng",
    languageName: "English",
    languageEnglishName: "English",
    name: "Berean Standard Bible",
    englishName: "Berean Standard Bible",
    shortName: "BSB",
    textDirection: "ltr",
    complete: true,
    credit: "Public domain",
    sha256: "0".repeat(64),
    downloadBytes: 1,
    books: new Set(["MAT", "JHN"]),
    ...overrides,
  }
}

const SYNODAL = translation({
  id: "rus_syn",
  name: "Синодальный перевод",
  shortName: "SYN",
})

describe("stops and counters", () => {
  it("finds the gap stop for a verse the translation lacks (R21, AE9)", () => {
    expect(stopAt(matthew18, 11)).toEqual({ kind: "gap", number: 11 })
  })

  it("reads the counter total from the last verse number (KTD19, AE9)", () => {
    expect(matthew18.lastVerse).toBe(35)
    expect(counterLabel(stopAt(matthew18, 11), matthew18.lastVerse)).toBe(
      "11 / 35",
    )
    expect(counterLabel(stopAt(matthew18, 12), matthew18.lastVerse)).toBe(
      "12 / 35",
    )
  })

  it("keys a merged range by its verse numbers, not its list index", () => {
    // T4T John 4 has fewer stops than verses: three ranges are merged.
    expect(chapterPositions(t4tJohn4Chapter).length).toBeLessThan(
      t4tJohn4Chapter.lastVerse,
    )
    const merged = stopAt(t4tJohn4Chapter, 7)
    expect(verseRangeLabel(merged)).toBe("6-8")
    expect(counterLabel(merged, t4tJohn4Chapter.lastVerse)).toBe(
      `6-8 / ${t4tJohn4Chapter.lastVerse}`,
    )
  })

  it("finds the merged stop from any verse inside its range", () => {
    const positions = chapterPositions(t4tJohn4Chapter)
    const index = stopIndexForVerse(positions, 6)
    expect(stopIndexForVerse(positions, 7)).toBe(index)
    expect(stopIndexForVerse(positions, 8)).toBe(index)
  })

  it("clamps a verse past the chapter end to the last stop", () => {
    const positions = chapterPositions(matthew18)
    expect(stopIndexForVerse(positions, 99)).toBe(positions.length - 1)
    expect(stopIndexForVerse(positions, 0)).toBe(0)
  })

  it("reads the counter aloud in words", () => {
    expect(
      counterAccessibilityLabel(stopAt(matthew18, 11), matthew18.lastVerse),
    ).toBe("Verse 11 of 35")
    expect(
      counterAccessibilityLabel(
        stopAt(t4tJohn4Chapter, 6),
        t4tJohn4Chapter.lastVerse,
      ),
    ).toBe(`Verses 6 to 8 of ${t4tJohn4Chapter.lastVerse}`)
  })

  it("measures progress by the last verse the stop covers", () => {
    expect(chapterProgress(stopAt(matthew18, 11), 35)).toBeCloseTo(11 / 35)
    expect(chapterProgress(stopAt(t4tJohn4Chapter, 6), 54)).toBeCloseTo(8 / 54)
    expect(chapterProgress(stopAt(matthew18, 35), 35)).toBe(1)
  })
})

describe("passage labels", () => {
  it("names the book, chapter, and verse in the shown numbering (R42)", () => {
    expect(passageLabel("Matthew", 18, stopAt(matthew18, 11))).toBe(
      "Matthew 18:11",
    )
    expect(passageLabel("John", 4, stopAt(t4tJohn4Chapter, 7))).toBe(
      "John 4:6-8",
    )
    expect(chapterLabel("Psalms", 22)).toBe("Psalms 22")
  })
})

describe("translationLabel", () => {
  const viewer = { translationId: "BSB", source: "explicit" } as const

  it("shows the short name alone for the viewer's own translation", () => {
    const shown: ShownTranslation = {
      translation: translation(),
      reason: "viewer",
      viewer,
    }
    const label = translationLabel(shown, null)
    expect(label.text).toBe("BSB")
    expect(label.isFallback).toBe(false)
    expect(label.accessibilityLabel).toContain("Berean Standard Bible")
  })

  it("names the translation shown for a book fallback (R25)", () => {
    const shown: ShownTranslation = {
      translation: translation(),
      reason: "book-fallback",
      viewer: { translationId: "rus_syn", source: "explicit" },
    }
    const label = translationLabel(shown, SYNODAL)
    expect(label.isFallback).toBe(true)
    expect(label.text).toContain("BSB")
    expect(label.accessibilityLabel).toContain("Berean Standard Bible")
    expect(label.accessibilityLabel).toContain(SYNODAL.name)
  })

  it("marks BSB as an offline stand-in (R41)", () => {
    const shown: ShownTranslation = {
      translation: translation(),
      reason: "offline-stand-in",
      viewer: { translationId: "spa_rvg", source: "audio" },
    }
    const label = translationLabel(shown, null)
    expect(label.isFallback).toBe(true)
    expect(label.text).toContain("BSB")
    expect(label.text).toContain(READER_COPY.offlineStandIn)
  })
})

describe("copy", () => {
  it("credits Still in the footer (KD10, KD16)", () => {
    expect(READER_COPY.stillCredit).toBe("Powered by StillBibleApp.com")
  })

  it("says which verse the translation lacks (R21, AE9)", () => {
    expect(READER_COPY.missingVerse(11)).toBe(
      "This translation has no verse 11.",
    )
  })
})
