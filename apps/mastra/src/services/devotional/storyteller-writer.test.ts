import { describe, expect, it } from "vitest"

import {
  insightProblems,
  openingProblems,
  takeawayQuestionProblems,
  takeawayVoiceProblems,
  type OpeningLine,
} from "./storyteller-writer"

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

describe("takeawayQuestionProblems", () => {
  const ok = {
    takeaway:
      "This week, when God blesses someone else, thank him before you count what you got.",
    question: "Who is it hardest for you to be truly glad for right now?",
  }
  it("passes a weekly step and a personal question", () => {
    expect(takeawayQuestionProblems(ok)).toEqual([])
  })
  it("flags a takeaway that only restates the message", () => {
    const rules = takeawayQuestionProblems({
      ...ok,
      takeaway:
        "The Father who runs to the wanderer also comes out to plead with the worker.",
    }).map((p) => p.rule)
    expect(rules).toEqual(["takeaway-action"])
  })
  it("flags a takeaway too long to remember", () => {
    const rules = takeawayQuestionProblems({
      ...ok,
      takeaway:
        "This week, every time you notice that God has been kind to someone you find hard to love, stop and thank him for it out loud.",
    }).map((p) => p.rule)
    expect(rules).toEqual(["takeaway-length"])
  })
  it("flags a question about the story instead of the viewer", () => {
    const rules = takeawayQuestionProblems({
      ...ok,
      question: "Why did the older brother refuse to go in?",
    }).map((p) => p.rule)
    expect(rules).toEqual(["question-personal"])
  })
  it("flags two questions in one", () => {
    const rules = takeawayQuestionProblems({
      ...ok,
      question: "Who do you resent? Where are you standing?",
    }).map((p) => p.rule)
    expect(rules).toEqual(["question-one"])
  })
})

describe("takeawayVoiceProblems", () => {
  it("allows the takeaway's 'This week,' step", () => {
    expect(
      takeawayVoiceProblems(
        "This week, remember to thank God when someone else is blessed.",
      ),
    ).toEqual([])
  })
  it("still catches a command outside the weekly step", () => {
    expect(
      takeawayVoiceProblems("In every storm, remember that Jesus is with you."),
    ).not.toEqual([])
  })
})

describe("insightProblems", () => {
  const words = (n: number) => Array.from({ length: n }, () => "word").join(" ")
  const p = (role: string, n: number) => ({ role, text: words(n) })

  it("passes one explained block, or no insight at all", () => {
    expect(
      insightProblems([
        p("reflection", 20),
        p("history", 40),
        p("history", 30),
        p("reflection", 20),
      ]),
    ).toEqual([])
    expect(insightProblems([p("reflection", 20), p("classic", 30)])).toEqual([])
  })

  it("flags a two-sentence note left unexplained (Bartimaeus draft, 24 words)", () => {
    expect(
      insightProblems([p("reflection", 20), p("history", 24)]).map(
        (x) => x.rule,
      ),
    ).toEqual(["insight-thin"])
  })

  it("flags an insight split over two places", () => {
    expect(
      insightProblems([
        p("language", 40),
        p("reflection", 20),
        p("reflection", 20),
        p("language", 40),
      ]).map((x) => x.rule),
    ).toEqual(["insight-scattered"])
  })

  it("allows one paragraph of the writer's own inside the block", () => {
    expect(
      insightProblems([
        p("history", 35),
        p("reflection", 20),
        p("history", 35),
      ]),
    ).toEqual([])
  })
})
