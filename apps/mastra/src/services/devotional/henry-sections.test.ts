import { describe, expect, it } from "vitest"

import { henrySectionForVerses, henrySections } from "./henry-sections"

/**
 * Representative Henry-shaped chapter text. The production corpus lives in the
 * devotional Workspace, so this test must not depend on a local `devo/` symlink.
 */
function luke19(): string {
  return [
    "In this chapter we have, I. The conversion of Zaccheus the publican at Jericho, ver. 1-10. II. The parable of the pounds, ver. 11-27. III. Christ's riding in triumph, ver. 28-44. IV. His driving buyers and sellers out of the temple, ver. 45-48.",
    " 1 He entered and was passing through Jericho. 2 There was a man named Zaccheus. 3 He sought to see who Jesus was, and forgot his gravity, as chief of the publicans. The exposition may cite 1 Cor. xii. 7 and 1 Pet. iv. 10 without beginning a new section. 10 For the Son of Man came to seek and to save that which was lost.",
    " 11 As they heard these things, he added and spoke a parable of the pounds. This second section is not part of Zaccheus.",
    " 28 Having said these things, he went on ahead, going up to Jerusalem in triumph.",
    " 45 He entered into the temple and began to drive out those who bought and sold in it.",
  ].join("\n\n")
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
    expect(section.text.split(/\s+/).length).toBeLessThan(whole)
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
