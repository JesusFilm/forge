import { describe, expect, it } from "vitest"

import {
  matchReflection,
  matchSpurgeonTheme,
  parseOsis,
  selectReflection,
} from "./reflection-corpus"
import type { ReflectionCorpora, ReflectionEntry } from "./reflection-corpus"

const ryleMatthew: ReflectionEntry[] = [
  {
    source: "J.C. Ryle, Expository Thoughts on the Gospels: Matthew",
    reference: "Matthew 8:23-27",
    osisRef: "Matt.8.23-Matt.8.27",
    text: "Ryle on the storm.",
  },
  {
    source: "J.C. Ryle, Expository Thoughts on the Gospels: Matthew",
    reference: "Matthew 8:28-34",
    osisRef: "Matt.8.28-Matt.8.34",
    text: "Ryle on the demoniac.",
  },
]

const matthewHenry: ReflectionEntry[] = [
  {
    source: "Matthew Henry, Commentary on the Whole Bible",
    reference: "Luke 8",
    osisRef: "Luke.8",
    text: "Henry on Luke 8, including the storm.",
  },
  {
    source: "Matthew Henry, Commentary on the Whole Bible",
    reference: "John 11",
    osisRef: "John.11",
    text: "Henry on John 11 (Lazarus).",
  },
]

const corpora = { ryleMatthew, matthewHenry }

describe("parseOsis", () => {
  it("parses the start of a range", () => {
    expect(parseOsis("Luke.8.22-Luke.8.25")).toEqual({
      book: "Luke",
      chapter: 8,
      verse: 22,
    })
  })
  it("parses a chapter-only ref (no verse)", () => {
    expect(parseOsis("John.11")).toEqual({
      book: "John",
      chapter: 11,
      verse: null,
    })
  })
  it("parses numbered books", () => {
    expect(parseOsis("1John.4.7")).toEqual({
      book: "1John",
      chapter: 4,
      verse: 7,
    })
  })
  it("returns null on garbage", () => {
    expect(parseOsis("nonsense")).toBeNull()
  })
})

describe("matchReflection", () => {
  it("routes a Matthew passage to the Ryle section that covers it", () => {
    const m = matchReflection("Matt.8.23-Matt.8.27", corpora)
    expect(m?.source).toContain("Ryle")
    expect(m?.reference).toBe("Matthew 8:23-27")
    expect(m?.focusReference).toBe("Matt.8.23-Matt.8.27")
  })

  it("picks the correct Ryle section by verse within a chapter", () => {
    expect(matchReflection("Matt.8.30", corpora)?.reference).toBe(
      "Matthew 8:28-34",
    )
  })

  it("routes Mark/Luke/John to the Matthew Henry chapter", () => {
    expect(matchReflection("Luke.8.22-Luke.8.25", corpora)?.reference).toBe(
      "Luke 8",
    )
    expect(matchReflection("John.11.1-John.11.44", corpora)?.source).toContain(
      "Matthew Henry",
    )
  })

  it("returns null outside the Gospels", () => {
    expect(matchReflection("Rom.8.28", corpora)).toBeNull()
  })

  it("returns null when no entry covers the passage", () => {
    expect(matchReflection("Luke.24.1", corpora)).toBeNull()
  })
})

const spurgeon: ReflectionEntry[] = [
  {
    source: "Charles Spurgeon, Morning and Evening",
    reference: "Isaiah 26:3",
    osisRef: "Isa.26.3",
    verse: "You keep him in perfect peace whose mind is stayed on you.",
    text: "In the storms of life we may have peace when we trust the Lord.",
  },
  {
    source: "Charles Spurgeon, Morning and Evening",
    reference: "Psalm 23:1",
    osisRef: "Ps.23.1",
    verse: "The Lord is my shepherd.",
    text: "A meditation about provision and rest, mentioning grace.",
  },
]

describe("matchSpurgeonTheme", () => {
  it("scores verse hits above body hits and returns the best entry", () => {
    const m = matchSpurgeonTheme(["storm", "peace", "trust"], spurgeon)
    expect(m?.reference).toBe("Isaiah 26:3") // "peace" in verse (+2), "storm"/"trust" in body
  })

  it("returns null when no theme keyword matches", () => {
    expect(matchSpurgeonTheme(["dragons"], spurgeon)).toBeNull()
    expect(matchSpurgeonTheme([], spurgeon)).toBeNull()
  })
})

describe("selectReflection (rotation)", () => {
  const full: ReflectionCorpora = { ryleMatthew, matthewHenry, spurgeon }
  const base = {
    passageOsis: "Luke.8.22-Luke.8.25",
    reference: "Luke 8:22-25",
    themes: ["storm", "peace", "trust"],
  }

  it("even sequence → commentary (Matthew Henry on the passage)", () => {
    const r = selectReflection({ ...base, sequence: 0 }, full)
    expect(r?.flavor).toBe("commentary")
    expect(r?.source).toContain("Matthew Henry")
    expect(r?.focusReference).toBe("Luke 8:22-25")
  })

  it("odd sequence → Spurgeon (theme-matched)", () => {
    const r = selectReflection({ ...base, sequence: 1 }, full)
    expect(r?.flavor).toBe("spurgeon")
    expect(r?.source).toContain("Spurgeon")
    expect(r?.focusReference).toBe("Isaiah 26:3")
  })

  it("falls back to commentary when Spurgeon has no theme match", () => {
    const r = selectReflection(
      { ...base, themes: ["nothingmatches"], sequence: 1 },
      full,
    )
    expect(r?.flavor).toBe("commentary")
  })

  it("falls back to Spurgeon when the passage isn't in the Gospels commentary", () => {
    const r = selectReflection(
      {
        passageOsis: "Rom.8.28",
        reference: "Romans 8:28",
        themes: ["peace"],
        sequence: 0,
      },
      full,
    )
    expect(r?.flavor).toBe("spurgeon")
  })
})
