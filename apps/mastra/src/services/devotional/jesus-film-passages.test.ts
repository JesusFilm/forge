import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

import { parseJesusFilmCatalogDocument } from "./jesus-film-catalog"
import {
  chapterWithPassage,
  mappedChapterIndices,
  parseJesusFilmPassagesDocument,
  passageForChapter,
} from "./jesus-film-passages"
import { matchReflection, parseOsis } from "./reflection-corpus"

const CURATED_WINDOW_INDICES = [5, 14, 19, 21, 31, 33, 55, 59]
const fixture = (name: string) =>
  readFileSync(path.resolve("devotional-workspace/inputs/video", name), "utf8")
const JESUS_FILM_CHAPTERS = parseJesusFilmCatalogDocument({
  path: "/inputs/video/jesus-film-catalog.json",
  content: fixture("jesus-film-catalog.json"),
})
const JESUS_FILM_PASSAGES = parseJesusFilmPassagesDocument({
  path: "/inputs/video/jesus-film-passages.json",
  content: fixture("jesus-film-passages.json"),
})

function humanReferenceToOsis(reference: string): string | null {
  const match = reference.match(
    /^(Genesis|Luke) (\d+):(\d+)(?:-(?:(\d+):)?(\d+))?$/,
  )
  if (!match) return null
  const [, humanBook, startChapter, startVerse, endChapter, endVerse] = match
  const book = humanBook === "Genesis" ? "Gen" : "Luke"
  if (!endVerse) return `${book}.${startChapter}.${startVerse}`
  return `${book}.${startChapter}.${startVerse}-${book}.${endChapter ?? startChapter}.${endVerse}`
}

describe("JESUS_FILM_PASSAGES", () => {
  it("has exactly one mapping for each of the 61 catalog chapters", () => {
    const expected = Array.from({ length: 61 }, (_, index) => index + 1)
    const indices = mappedChapterIndices(JESUS_FILM_PASSAGES)

    expect(JESUS_FILM_PASSAGES).toHaveLength(61)
    expect(new Set(indices).size).toBe(61)
    expect([...indices].sort((a, b) => a - b)).toEqual(expected)
    expect(JESUS_FILM_CHAPTERS.map((chapter) => chapter.index)).toEqual(
      expected,
    )
  })

  it("uses well-formed canonical OSIS and matching human references", () => {
    for (const passage of JESUS_FILM_PASSAGES) {
      expect(parseOsis(passage.osisRef), passage.reference).not.toBeNull()
      expect(humanReferenceToOsis(passage.reference), passage.reference).toBe(
        passage.osisRef,
      )
      expect(
        passage.osisRef.startsWith("Luke.") || passage.index === 1,
        passage.reference,
      ).toBe(true)
    }
  })

  it("joins every passage to the matching catalog index, id, and title", () => {
    for (const chapter of JESUS_FILM_CHAPTERS) {
      const joined = chapterWithPassage(
        chapter.index,
        JESUS_FILM_PASSAGES,
        JESUS_FILM_CHAPTERS,
      )
      expect(joined, `index ${chapter.index}`).not.toBeNull()
      expect(joined?.index).toBe(chapter.index)
      expect(joined?.id).toBe(chapter.id)
      expect(joined?.title).toBe(chapter.title)
      expect(joined?.start).toBe(chapter.start)
      expect(joined?.reference).toBe(
        JESUS_FILM_PASSAGES[chapter.index - 1]?.reference,
      )
    }
  })

  it("carries theme keywords for every chapter", () => {
    for (const passage of JESUS_FILM_PASSAGES) {
      expect(passage.themes.length, passage.reference).toBeGreaterThan(0)
      expect(passage.themes.every((theme) => theme.trim().length > 0)).toBe(
        true,
      )
    }
  })

  it("preserves only the eight owner-curated clip windows", () => {
    const withWindows = JESUS_FILM_PASSAGES.filter(
      (passage) => passage.clipStartSec != null,
    )
    expect(withWindows.map((passage) => passage.index)).toEqual(
      CURATED_WINDOW_INDICES,
    )
    for (const passage of JESUS_FILM_PASSAGES) {
      expect(passage.clipStartSec == null).toBe(passage.clipLengthSec == null)
      if (passage.clipLengthSec != null) {
        expect(passage.clipLengthSec, passage.reference).toBeGreaterThanOrEqual(
          20,
        )
      }
    }
  })

  it("routes every Luke-primary mapping to a reflection source", () => {
    const chapters = [
      ...new Set(
        JESUS_FILM_PASSAGES.map((passage) => parseOsis(passage.osisRef))
          .filter((parts) => parts?.book === "Luke")
          .map((parts) => parts!.chapter),
      ),
    ]
    const matthewHenry = chapters.map((chapter) => ({
      source: "Matthew Henry, Commentary on the Whole Bible",
      reference: `Luke ${chapter}`,
      osisRef: `Luke.${chapter}`,
      text: `Henry on Luke ${chapter}.`,
    }))

    for (const passage of JESUS_FILM_PASSAGES.filter(
      (entry) => entry.index > 1,
    )) {
      expect(
        matchReflection(passage.osisRef, {
          ryleMatthew: [],
          matthewHenry,
        }),
        passage.reference,
      ).not.toBeNull()
    }
  })
})

describe("passage lookups", () => {
  it("passageForChapter returns the mapping or null", () => {
    expect(passageForChapter(19, JESUS_FILM_PASSAGES)?.reference).toBe(
      "Luke 8:22-25",
    )
    expect(passageForChapter(61, JESUS_FILM_PASSAGES)?.reference).toBe(
      "Luke 24:46-49",
    )
    expect(passageForChapter(999, JESUS_FILM_PASSAGES)).toBeNull()
  })

  it("chapterWithPassage joins the catalog identity and start offset", () => {
    const chapter = chapterWithPassage(
      19,
      JESUS_FILM_PASSAGES,
      JESUS_FILM_CHAPTERS,
    )
    expect(chapter?.title).toBe("Jesus Calms the Storm")
    expect(chapter?.id).toMatch(/^1_jf/)
    expect(chapter?.start).toBe("0:45:44")
    expect(chapter?.mood).toBe("peace")
  })
})
