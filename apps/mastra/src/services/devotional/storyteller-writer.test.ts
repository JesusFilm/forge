import { describe, expect, it } from "vitest"

import {
  insightProblems,
  openingProblems,
  takeawayQuestionProblems,
  takeawayVoiceProblems,
  wornMoves,
  type OpeningLine,
} from "./storyteller-writer"

const o = (line: string): OpeningLine => ({ line, visual: "v", onScreen: "" })
const good = [
  o("Some prayers we quietly stop praying, because nothing changes."),
  o("Jesus tells of a judge who could be bought."),
  o("And a widow with nothing to pay, who keeps coming back."),
  o("In this devotional, we look at who this judge really was."),
]

describe("openingProblems", () => {
  it("passes nerve, story and one preview as the last line (2026-10-14)", () => {
    expect(openingProblems(good)).toEqual([])
    expect(openingProblems([good[0], good[1], good[3]])).toEqual([])
  })

  it("wants exactly one preview line, and it is the last", () => {
    const rules = (lines: OpeningLine[]) =>
      openingProblems(lines).map((p) => p.rule)
    expect(
      rules([...good.slice(0, 3), o("And the judge gives in.")]),
    ).toContain("opening-preview")
    expect(rules([good[0], good[3], good[1], good[2]])).toContain(
      "opening-preview-last",
    )
  })

  it("opens on the viewer's nerve, never on the worn formula", () => {
    const rules = (lines: OpeningLine[]) =>
      openingProblems(lines).map((p) => p.rule)
    expect(
      rules([o("A judge sits in a small town."), ...good.slice(1)]),
    ).toContain("opening-nerve")
    for (const worn of [
      "This video is for you if you are tired of asking.",
      "If you have ever stopped praying, this is for you.",
      "Have you ever given up on a prayer?",
    ])
      expect(rules([o(worn), ...good.slice(1)])).toContain(
        "opening-nerve-formula",
      )
  })

  it("refuses greetings, teaser talk and a written 'Let's watch'", () => {
    for (const bad of [
      "Welcome to Daily Bible Pause.",
      "Stay tuned for the twist.",
      "Let's watch.",
    ]) {
      expect(
        openingProblems([good[0], o(bad), ...good.slice(2)]).some(
          (p) => p.rule === "opening-no-teaser-talk",
        ),
      ).toBe(true)
    }
  })

  it("keeps lines short and the opening three to five lines", () => {
    const long = o(
      "We all know the prayers we stopped praying long ago because nothing ever changed",
    )
    expect(
      openingProblems([long, ...good.slice(1)]).map((p) => p.rule),
    ).toContain("opening-line-too-long")
    expect(openingProblems(good.slice(2)).map((p) => p.rule)).toContain(
      "opening-length",
    )
    const wordy = good.map((l) => o(`${l.line} And then some more words.`))
    expect(openingProblems(wordy).map((p) => p.rule)).toContain(
      "opening-too-long",
    )
  })

  it("wants a full, honest preview sentence", () => {
    const rules = (lines: OpeningLine[]) =>
      openingProblems(lines).map((p) => p.rule)
    expect(
      rules([...good.slice(0, 3), o("In this devotional: the judge.")]),
    ).toContain("opening-preview-sentence")
    expect(
      rules([
        ...good.slice(0, 3),
        o("In this devotional, we look at a judge who changes everything."),
      ]),
    ).toContain("opening-preview-hype")
  })

  it("does not say watch in the last line, nor reuse the reflection's words", () => {
    expect(
      openingProblems([
        ...good.slice(0, 3),
        o("In this devotional, we watch who this judge was."),
      ]).map((p) => p.rule),
    ).toContain("opening-bridge")
    const reflection = [{ text: "Jesus tells of a judge who could be bought." }]
    expect(openingProblems(good, reflection).map((p) => p.rule)).toContain(
      "opening-reuses-reflection",
    )
    expect(
      openingProblems(good, [{ text: "The widow had nothing to pay with." }]),
    ).toEqual([])
  })
})

describe("takeawayQuestionProblems", () => {
  const ok = {
    takeaway:
      "When God blesses someone else, thank him before you count what you got.",
    question: "Who is it hardest for you to be truly glad for right now?",
  }
  it("passes a step and a personal question, with no fixed opener", () => {
    expect(takeawayQuestionProblems(ok)).toEqual([])
    expect(
      takeawayQuestionProblems({
        ...ok,
        takeaway: "This week, sit with Jesus before you start the work.",
      }),
    ).toEqual([])
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
  it("passes a conclusion stated as a truth", () => {
    expect(
      takeawayVoiceProblems(
        "Healing met them on the road; wholeness waited at His feet.",
      ),
    ).toEqual([])
  })
  it("catches a step for next time, the takeaway's old shape", () => {
    expect(
      takeawayVoiceProblems(
        "The next time a prayer is answered, stop and thank Jesus before you tell anyone else.",
      ),
    ).not.toEqual([])
    expect(
      takeawayVoiceProblems(
        "When something you prayed for arrives, say thank you to Jesus first.",
      ),
    ).not.toEqual([])
  })
  it("still catches a collective command", () => {
    expect(
      takeawayVoiceProblems("Let us remember that Jesus is with us."),
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

describe("wornMoves", () => {
  const script = (texts: string[]) => ({
    title: "A title",
    opening: [],
    paragraphs: texts.map((text) => ({ text, role: "reflection" as const })),
  })

  it("flags the series' worn moves, sentence by sentence", () => {
    const hits = wornMoves(
      script([
        "The nine are not villains. They walked on.",
        "Most of us would side with Martha.",
        "It is an honest question, and Peter asks it.",
      ]),
    )
    expect(hits.map((h) => h.sentence)).toEqual([
      "The nine are not villains.",
      "Most of us would side with Martha.",
      "It is an honest question, and Peter asks it.",
    ])
  })

  it("leaves a story's own way into the turn alone", () => {
    expect(
      wornMoves(script(["One man stops on the road and turns around."])),
    ).toEqual([])
  })
})
