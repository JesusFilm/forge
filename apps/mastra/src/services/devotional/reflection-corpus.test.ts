import { describe, expect, it } from "vitest"

import {
  matchReflection,
  matchSpurgeonTheme,
  parseReflectionDocument,
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

// One pool, exactly as `addReflection` builds it: Ryle's per-pericope sections
// and Henry's whole-chapter treatments together, ranked by specificity.
const corpora = { commentary: [...ryleMatthew, ...matthewHenry] }

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

describe("parseReflectionDocument", () => {
  it("accepts a content-only Workspace reflection without frontmatter", () => {
    expect(
      parseReflectionDocument({
        path: "/inputs/reflections/new-source.md",
        content: "A newly dropped reflection.",
      }),
    ).toEqual([
      {
        source: "new-source",
        reference: "new-source",
        osisRef: null,
        text: "A newly dropped reflection.",
      },
    ])
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

  it("falls back to a whole-chapter treatment when no section covers", () => {
    expect(matchReflection("Luke.8.22-Luke.8.25", corpora)?.reference).toBe(
      "Luke 8",
    )
    expect(matchReflection("John.11.1-John.11.44", corpora)?.source).toContain(
      "Matthew Henry",
    )
  })

  it("prefers the narrowest covering entry over a whole chapter", () => {
    // The reason this pool exists: both entries cover Luke 19:1-10, and the
    // pericope-level one is the better devotional source. Preference is span,
    // not authorship — no rule here names Ryle.
    const section: ReflectionEntry = {
      source: "J.C. Ryle, Expository Thoughts on the Gospels: Luke",
      reference: "The Conversion of Zacchaeus, Luke 19:1-10",
      osisRef: "Luke.19.1-Luke.19.10",
      text: "Ryle on Zacchaeus.",
    }
    const chapter: ReflectionEntry = {
      source: "Matthew Henry, Commentary on the Whole Bible",
      reference: "Luke 19",
      osisRef: "Luke.19",
      text: "Henry on the whole of Luke 19.",
    }

    for (const commentary of [
      [chapter, section],
      [section, chapter],
    ]) {
      // Document order must not decide it: reconcile lists files alphabetically,
      // which would otherwise put Henry first and silently win.
      const m = matchReflection("Luke.19.1-Luke.19.10", { commentary })
      expect(m?.osisRef).toBe("Luke.19.1-Luke.19.10")
      expect(m?.source).toContain("Ryle")
    }

    // ...and the chapter entry still answers verses no section covers.
    expect(
      matchReflection("Luke.19.41", { commentary: [section, chapter] })
        ?.osisRef,
    ).toBe("Luke.19")
  })

  it("answers a chapter-wide passage with the chapter treatment", () => {
    // A verse-less passage names the whole chapter, so the narrowest section
    // would be an arbitrary slice of it.
    const commentary: ReflectionEntry[] = [
      {
        source: "J.C. Ryle, Expository Thoughts on the Gospels: Luke",
        reference: "Luke 8:22-25",
        osisRef: "Luke.8.22-Luke.8.25",
        text: "Ryle on the storm.",
      },
      ...matthewHenry,
    ]
    expect(matchReflection("Luke.8", { commentary })?.reference).toBe("Luke 8")
  })

  it("keys servable books on the pool, not on a Gospel allowlist", () => {
    // Nothing covers Romans here...
    expect(matchReflection("Rom.8.28", corpora)).toBeNull()
    // ...but a pool that does covers it, with no code change. This is what lets
    // the Genesis prologue become servable by adding a volume.
    const genesis: ReflectionEntry = {
      source: "Matthew Henry, Commentary on the Whole Bible",
      reference: "Genesis 1",
      osisRef: "Gen.1",
      text: "Henry on Genesis 1.",
    }
    expect(
      matchReflection("Gen.1.26-Gen.3.24", { commentary: [genesis] })
        ?.reference,
    ).toBe("Genesis 1")
  })

  it("returns null when no entry covers the passage", () => {
    // Henry on Luke 8 must NOT answer a Luke 24 passage: a verse-less range end
    // bounds at its own chapter rather than running open-ended.
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
  const full: ReflectionCorpora = {
    commentary: [...ryleMatthew, ...matthewHenry],
    spurgeon,
  }
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
