import { describe, expect, it } from "vitest"

import { openingProblems, type OpeningLine } from "./storyteller-writer"

const o = (line: string): OpeningLine => ({ line, visual: "v", onScreen: "" })
const good = [
  o("He never left. Now he will not go in."),
  o("His brother wasted everything, and the party is for him."),
  o("In this devotional: one word in the father's reply, about the feast."),
  o("It starts with a father and two sons."),
]

describe("openingProblems", () => {
  it("passes a promise, context, gap, one preview and a bridge", () => {
    expect(openingProblems(good)).toEqual([])
  })

  it("wants exactly one preview line, not the last one", () => {
    const rules = (lines: OpeningLine[]) =>
      openingProblems(lines).map((p) => p.rule)
    expect(
      rules([...good.slice(0, 2), o("And the father comes out."), good[3]]),
    ).toContain("opening-preview")
    expect(rules([good[0], good[1], good[3], good[2]])).toContain(
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
    const wordy = good.map((l) => o(`${l.line} And then some more words.`))
    expect(openingProblems(wordy).map((p) => p.rule)).toContain(
      "opening-too-long",
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
      o("His brother burned through his share far from home."),
      ...good.slice(2),
    ]
    expect(openingProblems(reused, reflection).map((p) => p.rule)).toContain(
      "opening-reuses-reflection",
    )
    expect(openingProblems(good, reflection)).toEqual([])
  })
})
