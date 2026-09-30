import { describe, expect, it } from "vitest"

import { openingProblems, type OpeningLine } from "./storyteller-writer"

const o = (line: string): OpeningLine => ({ line, visual: "v", onScreen: "" })
const good = [
  o("The son who stayed outside."),
  o("He worked all day and did everything right."),
  o("Then he heard music, and it was not for him."),
  o("In this devotional: one word in the father's last sentence."),
  o("Jesus told a story about a son like him."),
]

describe("openingProblems", () => {
  it("passes a promise, context, gap, one preview and a bridge", () => {
    expect(openingProblems(good)).toEqual([])
  })

  it("wants exactly one preview line, not the last one", () => {
    const rules = (lines: OpeningLine[]) =>
      openingProblems(lines).map((p) => p.rule)
    expect(rules(good.filter((_, i) => i !== 3))).toContain("opening-preview")
    expect(rules([...good.slice(0, 3), good[4], good[3]])).toContain(
      "opening-bridge",
    )
  })

  it("refuses greetings, teaser talk and a written 'Let's watch'", () => {
    for (const bad of [
      "Welcome to Daily Bible Pause.",
      "Stay tuned for the twist.",
      "Let's watch.",
    ]) {
      expect(
        openingProblems([o(bad), ...good.slice(1)]).some(
          (p) => p.rule === "opening-no-teaser-talk",
        ),
      ).toBe(true)
    }
  })

  it("keeps the first line short and the opening four to six lines", () => {
    const long = o(
      "The older son who stayed home and worked every day came back from the field",
    )
    expect(
      openingProblems([long, ...good.slice(1)]).map((p) => p.rule),
    ).toContain("opening-promise")
    expect(openingProblems(good.slice(0, 3)).map((p) => p.rule)).toContain(
      "opening-length",
    )
  })

  it("does not say watch in the bridge, nor reuse the reflection's words", () => {
    const withWatch = [
      ...good.slice(0, 4),
      o("The father comes out. Watch what he does."),
    ]
    expect(openingProblems(withWatch).map((p) => p.rule)).toContain(
      "opening-bridge",
    )
    const reflection = [
      { text: "His brother burned through his share far from home." },
    ]
    const reused = [
      good[0],
      o("His brother burned through his share far from home, feeding pigs."),
      ...good.slice(2),
    ]
    expect(openingProblems(reused, reflection).map((p) => p.rule)).toContain(
      "opening-reuses-reflection",
    )
    expect(openingProblems(good, reflection)).toEqual([])
  })
})
