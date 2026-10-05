import { describe, expect, it } from "vitest"

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  BSB,
  BibleCorpusMissingError,
  DEVOTIONAL_BIBLE,
  WEB,
  getVerseText,
  loadBible,
  lookupVerse,
  parseReference,
} from "./bible-text"

const verses = {
  "Luke.8.24":
    "He awoke, and rebuked the wind and the raging of the water; and they ceased, and it was calm.",
  "Luke.8.25": "He said to them, “Where is your faith?”",
  "John.11.25": "Jesus said to her, “I am the resurrection and the life.”",
}

describe("parseReference", () => {
  it("parses a single verse", () => {
    expect(parseReference("Luke 8:24")).toEqual({
      osis: "Luke",
      chapter: 8,
      startVerse: 24,
      endVerse: 24,
    })
  })
  it("parses a range", () => {
    expect(parseReference("Luke 8:24-25")).toMatchObject({
      startVerse: 24,
      endVerse: 25,
    })
  })
  it("maps full book names to osis", () => {
    expect(parseReference("Matthew 8:26")?.osis).toBe("Matt")
    expect(parseReference("John 11:25")?.osis).toBe("John")
  })
  it("returns null for an unknown book or malformed ref", () => {
    expect(parseReference("Hezekiah 1:1")).toBeNull() // no such book
    expect(parseReference("nonsense")).toBeNull()
  })
})

describe("lookupVerse", () => {
  it("returns the exact verse text", () => {
    expect(lookupVerse("Luke 8:25", verses)).toBe(
      "He said to them, “Where is your faith?”",
    )
  })
  it("joins a range", () => {
    expect(lookupVerse("Luke 8:24-25", verses)).toBe(
      "He awoke, and rebuked the wind and the raging of the water; and they ceased, and it was calm. He said to them, “Where is your faith?”",
    )
  })
  it("returns null when a verse in the range is missing", () => {
    expect(lookupVerse("Luke 8:24-26", verses)).toBeNull()
  })
  it("returns null for an unparseable/unknown reference", () => {
    expect(lookupVerse("Genesis 1:1", verses)).toBeNull()
  })
})

describe("loadBible / getVerseText", () => {
  it("quotes the Berean Standard Bible by default", () => {
    expect(DEVOTIONAL_BIBLE).toBe(BSB)
    expect(BSB.file).toBe("bsb-bible.json")
  })

  it("reads the series translation's corpus from the corpus dir", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bible-"))
    writeFileSync(
      path.join(dir, BSB.file),
      JSON.stringify({ verses: { "Luke.8.16": "No one lights a lamp…" } }),
    )
    expect(getVerseText("Luke 8:16", dir)).toBe("No one lights a lamp…")
    expect(getVerseText("Luke 8:17", dir)).toBeNull()
  })

  it("can still read the WEB corpus when asked for it explicitly", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bible-"))
    writeFileSync(
      path.join(dir, WEB.file),
      JSON.stringify({ verses: { "Luke.8.16": "No one, when he has lit…" } }),
    )
    expect(getVerseText("Luke 8:16", dir, WEB)).toBe("No one, when he has lit…")
  })

  it("fails loudly when the corpus is missing instead of quoting nothing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bible-"))
    expect(() => loadBible(BSB, dir)).toThrow(BibleCorpusMissingError)
    expect(() => loadBible(BSB, dir)).toThrow(/ingest-bsb-bible/)
  })
})

describe("the whole Bible (BSB, 2026-10-05)", () => {
  it("parses Old Testament and multi-word book names", () => {
    expect(parseReference("Psalm 27:4")).toEqual({
      osis: "Ps",
      chapter: 27,
      startVerse: 4,
      endVerse: 4,
    })
    expect(parseReference("Song of Solomon 2:1-2")?.osis).toBe("Song")
    expect(parseReference("1 John 4:8")?.osis).toBe("1John")
    expect(parseReference("Psalms 46:10")?.osis).toBe("Ps")
  })
})
