import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { chaptersWithReflectionSource } from "./generate-devotional"
import { parseJesusFilmCatalogDocument } from "./jesus-film-catalog"
import {
  chapterWithPassage,
  mappedChapterIndices,
  parseJesusFilmPassagesDocument,
  type ChapterWithPassage,
} from "./jesus-film-passages"
import {
  parseReflectionDocument,
  type ReflectionCorpora,
} from "./reflection-corpus"

/**
 * The clip pool must not offer a chapter whose reflection cannot be resolved.
 * `composeDevotionalContent` throws on a null selection, and a failed run never
 * records its clip, so `chooseChapter` returns that same lowest never-used index
 * on the next run: one unservable chapter wedges the whole daily schedule rather
 * than costing a single day. Real committed data throughout — the catalogue, the
 * passage map, and the seeded corpus are exactly what production reconciles.
 */

const seed = (relative: string) =>
  readFileSync(path.resolve("devotional-workspace/inputs", relative), "utf8")

const CHAPTERS = parseJesusFilmCatalogDocument({
  path: "/inputs/video/jesus-film-catalog.json",
  content: seed("video/jesus-film-catalog.json"),
})
const PASSAGES = parseJesusFilmPassagesDocument({
  path: "/inputs/video/jesus-film-passages.json",
  content: seed("video/jesus-film-passages.json"),
})

const MAPPED: ChapterWithPassage[] = mappedChapterIndices(PASSAGES)
  .map((index) => chapterWithPassage(index, PASSAGES, CHAPTERS))
  .filter((chapter): chapter is ChapterWithPassage => chapter !== null)

function committedCorpora(): ReflectionCorpora {
  const load = (name: string) =>
    parseReflectionDocument({
      path: `/inputs/reflections/${name}`,
      content: seed(`reflections/${name}`),
    })
  return {
    commentary: [
      ...load("ryle-matthew.json"),
      ...load("ryle-luke.json"),
      ...load("matthew-henry-mark.json"),
      ...load("matthew-henry-luke.json"),
      ...load("matthew-henry-john.json"),
    ],
    spurgeon: [],
  }
}

describe("chaptersWithReflectionSource", () => {
  it("admits every catalogued chapter the committed corpus can serve", () => {
    const pool = chaptersWithReflectionSource(MAPPED, committedCorpora(), 0)

    expect(MAPPED).toHaveLength(61)
    expect(pool).toHaveLength(60)
    // Chapter 1 is the Genesis prologue; the Gospel corpora cannot reflect on
    // it, and it is the LOWEST index, so an unfiltered pool hands it to every
    // automatic run.
    expect(pool.map((chapter) => chapter.index)).not.toContain(1)
    expect(Math.min(...pool.map((chapter) => chapter.index))).toBe(2)
    for (const chapter of pool) {
      expect(chapter.osisRef, chapter.reference).toMatch(/^Luke\./u)
    }
  })

  it("keys on the corpus rather than on the chapter number", () => {
    // A thematic source is not passage-keyed, so `selectReflection` falls back
    // to theme matching and Genesis becomes servable. This is what separates the
    // real predicate from a hardcoded `index > 1`: the same chapter, admitted,
    // because the corpus changed.
    const corpora = committedCorpora()
    const thematic: ReflectionCorpora = {
      ...corpora,
      spurgeon: [
        {
          source: "Charles Spurgeon, Morning and Evening",
          reference: "Genesis 1:27",
          osisRef: null,
          verse: "God created man in his own image",
          text: "A thematic meditation on creation, image, and beginning.",
        },
      ],
    }

    const pool = chaptersWithReflectionSource(MAPPED, thematic, 0)
    expect(pool).toHaveLength(61)
    expect(pool.map((chapter) => chapter.index)).toContain(1)
  })

  it("returns an empty pool when no corpus is loaded", () => {
    // Reachability for the caller's fail-loud guard: better an explicit refusal
    // than reserving a clip no devotional can be written for.
    expect(
      chaptersWithReflectionSource(MAPPED, { commentary: [], spurgeon: [] }, 0),
    ).toHaveLength(0)
  })

  it("is applied by the workflow before a clip is reserved", () => {
    // The predicate is a one-line revert away at the call site, and no unit test
    // of this module would notice. Pin the ordering in the workflow source.
    const source = readFileSync(
      path.resolve("src/mastra/workflows/video-first-devotional.ts"),
      "utf8",
    )
    const filtered = source.indexOf("chaptersWithReflectionSource(")
    const reserved = source.indexOf("store.pick(pool)")
    expect(filtered).toBeGreaterThan(-1)
    expect(reserved).toBeGreaterThan(filtered)
  })
})
