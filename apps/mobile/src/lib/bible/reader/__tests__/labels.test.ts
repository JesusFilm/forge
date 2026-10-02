// The reader's labels (feat-553 R9, R21, R25, R41, R42, KTD19). The chapters
// are U1's real bible.helloao.org fixtures, normalized as the app reads them.
import bsbMatthew18 from "../../text/__tests__/fixtures/bsb-mat-18.json"
import t4tJohn4 from "../../text/__tests__/fixtures/eng_t4t-jhn-4.json"
import type { CatalogTranslation } from "../../data/catalog"
import type { ShownTranslation } from "../../language/defaultTranslation"
import { normalizeChapterFile } from "../../text/normalize"
import { chapterPositions } from "../../text/positions"
import type { Chapter, ChapterPosition } from "../../text/types"
import { getT } from "../../../../i18n/useT"
import { BIBLE_NOTICES } from "../../sheets/copy"
import {
  chapterLabel,
  chapterProgress,
  counterAccessibilityLabel,
  counterLabel,
  passageLabel,
  pillDownloadStatus,
  stopIndexForVerse,
  translationLabel,
  verseAtProgress,
  verseRangeLabel,
} from "../labels"

const T = getT("BibleReader")

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
      counterAccessibilityLabel(T, stopAt(matthew18, 11), matthew18.lastVerse),
    ).toBe("Verse 11 of 35")
    expect(
      counterAccessibilityLabel(
        T,
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

describe("verseAtProgress (U9, R18)", () => {
  it("lands a drag to 50% of a 36-verse chapter on verse 18", () => {
    expect(verseAtProgress(0.5, 36)).toBe(18)
  })

  it("inverts chapterProgress for every verse, so a still thumb stays put", () => {
    for (let verse = 1; verse <= 36; verse += 1) {
      expect(verseAtProgress(verse / 36, 36)).toBe(verse)
    }
  })

  it("keys by verse number: T4T John 4 has 50 stops but 54 verses (KTD19)", () => {
    expect(verseAtProgress(1, t4tJohn4Chapter.lastVerse)).toBe(54)
    expect(verseAtProgress(7 / 54, t4tJohn4Chapter.lastVerse)).toBe(7)
  })

  it("stops at the chapter's first and last verse", () => {
    expect(verseAtProgress(0, 36)).toBe(1)
    expect(verseAtProgress(-0.4, 36)).toBe(1)
    expect(verseAtProgress(1.7, 36)).toBe(36)
    expect(verseAtProgress(Number.NaN, 36)).toBe(1)
    expect(verseAtProgress(0.5, 0)).toBe(1)
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
    const label = translationLabel(T, shown, null, "John")
    expect(label.text).toBe("BSB")
    expect(label.note).toBeNull()
    expect(label.noteKey).toBeNull()
    expect(label.accessibilityLabel).toContain("Berean Standard Bible")
  })

  // The info button beside the pill shows the note (owner, 2026-09-28).
  it("says the pick does not include the book, for a book fallback (R25)", () => {
    const shown: ShownTranslation = {
      translation: translation(),
      reason: "book-fallback",
      viewer: { translationId: "rus_syn", source: "explicit" },
    }
    const label = translationLabel(T, shown, SYNODAL, "Obadiah")
    // The pill has room for the short name; the note says why.
    expect(label.text).toBe("BSB")
    expect(label.accessibilityLabel).toBe(
      "Translation: Berean Standard Bible. Change translation",
    )
    expect(label.note).toBe(
      `${SYNODAL.name} does not include Obadiah. The reader shows it in Berean Standard Bible.`,
    )
    // The key names the stand-in, not the book, so a name that loads later
    // keeps the same key.
    expect(label.noteKey).toBe(`book-fallback:${shown.translation.id}`)
    expect(translationLabel(T, shown, SYNODAL, "Авдий").noteKey).toBe(
      label.noteKey,
    )
  })

  it("says so with no name when the pick is not in the catalog", () => {
    const shown: ShownTranslation = {
      translation: translation(),
      reason: "book-fallback",
      viewer: { translationId: "gone_xyz", source: "explicit" },
    }
    expect(translationLabel(T, shown, null, "Obadiah").note).toBe(
      "This translation does not include Obadiah. The reader shows it in Berean Standard Bible.",
    )
  })

  it("marks BSB as an offline stand-in (R41)", () => {
    const shown: ShownTranslation = {
      translation: translation(),
      reason: "offline-stand-in",
      viewer: { translationId: "spa_rvg", source: "audio" },
    }
    const label = translationLabel(T, shown, null, "John")
    expect(label.text).toBe("BSB")
    expect(label.note).toBe(
      "You are offline. The reader shows this chapter in Berean Standard Bible.",
    )
    expect(label.noteKey).toBe(`offline-stand-in:${shown.translation.id}`)
  })
})

// The owner (2026-10-01): the download button left the top bar, so the
// translation pill shows a ring while a download runs. The owner dropped a
// cloud-check for a finished download the same day.
describe("the translation pill's download status", () => {
  const WEB = translation({
    id: "eng_web",
    name: "World English Bible",
    shortName: "WEB",
  })
  const shown: ShownTranslation = {
    translation: WEB,
    reason: "viewer",
    viewer: { translationId: "eng_web", source: "explicit" },
  }
  const downloading = {
    kind: "downloading" as const,
    phase: "transfer" as const,
    percent: 44.6,
    bytesWritten: 446,
    totalBytes: 1000,
  }
  const downloaded = {
    kind: "downloaded" as const,
    sha256: WEB.sha256,
    books: WEB.books,
    bytes: 1000,
  }

  it("is a ring while a download runs, and the label says the percent", () => {
    expect(pillDownloadStatus(downloading)).toEqual({
      kind: "downloading",
      progress: 0.446,
    })
    expect(
      translationLabel(T, shown, null, "John", downloading).accessibilityLabel,
    ).toBe(
      T("translationWithStatusAriaLabel", {
        name: "World English Bible",
        status: T("translationDownloadingAriaStatus", { percent: 45 }),
      }),
    )
  })

  it("is nothing once no download runs: on the device, not downloaded, or failed", () => {
    for (const state of [
      downloaded,
      { kind: "bundled" as const },
      { kind: "checking" as const },
      { kind: "not-downloaded" as const },
      { kind: "failed" as const, reason: "network" as const },
      null,
    ]) {
      expect(pillDownloadStatus(state)).toBeNull()
      expect(
        translationLabel(T, shown, null, "John", state).accessibilityLabel,
      ).toBe(T("translationAriaLabel", { name: "World English Bible" }))
    }
  })
})

describe("copy", () => {
  it("credits Still in the footer (KD10, KD16)", () => {
    expect(BIBLE_NOTICES.stillCredit).toBe("Powered by StillBibleApp.com")
  })

  it("says which verse the translation lacks (R21, AE9)", () => {
    expect(T("missingVerse", { verse: 11 })).toBe(
      "This translation has no verse 11.",
    )
  })
})
