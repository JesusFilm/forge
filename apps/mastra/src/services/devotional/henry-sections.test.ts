import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { henrySectionForVerses, henrySections } from "./henry-sections"

/**
 * Runs against the REAL ingested chapter, not a fixture. The whole point of
 * this module is that Henry's prose is irregular, so a fixture written to match
 * the parser would prove nothing about the corpus it has to survive.
 */
function luke19(): string {
  const raw = readFileSync(
    path.join(
      process.env.HOME ?? "",
      "Desktop/devo-data/devo/corpus/matthew-henry-gospels.json",
    ),
    "utf8",
  )
  const parsed = JSON.parse(raw)
  const items = Array.isArray(parsed)
    ? parsed
    : (parsed.entries ?? parsed.chapters ?? parsed.items)
  return items.find((x: { osisRef?: string }) => x.osisRef === "Luke.19").text
}

describe("henrySections on the real Luke 19", () => {
  it("finds the four divisions Henry names in his own outline", () => {
    expect(
      henrySections(luke19()).map((s) => [s.startVerse, s.endVerse]),
    ).toEqual([
      [1, 10],
      [11, 27],
      [28, 44],
      [45, 48],
    ])
  })

  it("cuts the chapter down to a third for the Zacchaeus passage", () => {
    const whole = luke19().split(/\s+/).length
    const section = henrySectionForVerses(luke19(), 3, 5)!
    expect(whole).toBeGreaterThan(10_000)
    expect(section.text.split(/\s+/).length).toBeLessThan(4_000)
  })

  it("keeps the detail the lesson rests on", () => {
    // "forgot his gravity, as chief of the publicans" — losing this in the cut
    // would defeat the purpose of choosing Henry for this episode at all.
    expect(henrySectionForVerses(luke19(), 3, 5)!.text).toContain(
      "forgot his gravity",
    )
  })

  it("excludes the other stories in the chapter", () => {
    const section = henrySectionForVerses(luke19(), 3, 5)!
    expect(section.text).not.toMatch(/parable of the pounds/i)
    expect(section.text).not.toMatch(/triumph/i)
  })

  it("is not fooled by scripture cross-references inside the exposition", () => {
    // The exposition quotes "1 Cor. xii. 7" and "1 Pet. iv. 10", which look
    // like the start of a verse-1 block to a naive scan and sit AFTER the real
    // divisions — a parser that took the last match would slice at the wrong
    // place and silently return the wrong story.
    const sections = henrySections(luke19())
    expect(sections[0].text).toContain("Zaccheus")
    expect(sections[1].text).toMatch(/pounds/i)
  })

  it("maps any verse in a range to that range's section", () => {
    for (const v of [1, 5, 10]) {
      expect(henrySectionForVerses(luke19(), v, v)!.startVerse).toBe(1)
    }
    expect(henrySectionForVerses(luke19(), 11, 27)!.startVerse).toBe(11)
    expect(henrySectionForVerses(luke19(), 46, 46)!.startVerse).toBe(45)
  })

  it("returns nothing rather than guessing when there is no outline", () => {
    expect(henrySections("Some prose with no outline at all.")).toEqual([])
    expect(henrySectionForVerses("Some prose.", 3, 5)).toBeNull()
  })
})
