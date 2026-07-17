import { describe, expect, it } from "vitest"

import { JESUS_FILM_CHAPTERS } from "./jesus-film-catalog"
import {
  chapterWithPassage,
  JESUS_FILM_PASSAGES,
  passageForChapter,
} from "./jesus-film-passages"
import { matchReflection, parseOsis } from "./reflection-corpus"

const GOSPELS = new Set(["Matt", "Mark", "Luke", "John"])

describe("JESUS_FILM_PASSAGES", () => {
  it("every entry points at a real catalog chapter", () => {
    for (const p of JESUS_FILM_PASSAGES) {
      const chapter = JESUS_FILM_CHAPTERS[p.index - 1]
      expect(chapter, `index ${p.index}`).toBeDefined()
      expect(chapter.index).toBe(p.index)
    }
  })

  it("every osisRef parses to a Gospel book", () => {
    for (const p of JESUS_FILM_PASSAGES) {
      const parsed = parseOsis(p.osisRef)
      expect(parsed, p.reference).not.toBeNull()
      expect(GOSPELS.has(parsed!.book), p.reference).toBe(true)
    }
  })

  it("has no duplicate chapter indices", () => {
    const ids = JESUS_FILM_PASSAGES.map((p) => p.index)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("every entry carries theme keywords for Spurgeon matching", () => {
    for (const p of JESUS_FILM_PASSAGES) {
      expect(p.themes.length, p.reference).toBeGreaterThan(0)
    }
  })

  it("every entry has a CURATED clip window (owner rule: the clip must match the devotional's meaning, never a default head-slice)", () => {
    for (const p of JESUS_FILM_PASSAGES) {
      expect(p.clipStartSec, `${p.reference}: clipStartSec`).toBeTypeOf(
        "number",
      )
      expect(p.clipLengthSec, `${p.reference}: clipLengthSec`).toBeTypeOf(
        "number",
      )
      expect(
        p.clipLengthSec!,
        `${p.reference}: window too short`,
      ).toBeGreaterThanOrEqual(20)
    }
  })

  it("routes to a real reflection source for each passage", () => {
    // Minimal fixtures: Henry has the Luke chapters our starter set uses.
    const matthewHenry = [4, 7, 8, 9, 10, 19, 23, 24].map((ch) => ({
      source: "Matthew Henry, Commentary on the Whole Bible",
      reference: `Luke ${ch}`,
      osisRef: `Luke.${ch}`,
      text: `Henry on Luke ${ch}.`,
    }))
    for (const p of JESUS_FILM_PASSAGES) {
      const m = matchReflection(p.osisRef, { ryleMatthew: [], matthewHenry })
      expect(m, p.reference).not.toBeNull()
    }
  })
})

describe("passage lookups", () => {
  it("passageForChapter returns the mapping or null", () => {
    expect(passageForChapter(19)?.reference).toBe("Luke 8:22-25")
    expect(passageForChapter(999)).toBeNull()
  })

  it("chapterWithPassage joins the catalog title", () => {
    const c = chapterWithPassage(19)
    expect(c?.title).toBe("Jesus Calms the Storm")
    expect(c?.id).toMatch(/^1_jf/)
    expect(c?.mood).toBe("peace")
  })
})
