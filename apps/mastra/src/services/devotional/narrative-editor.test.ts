import { describe, expect, it } from "vitest"

import {
  applyNarrativeFixes,
  checkPlantedDenials,
  checkQuotations,
  buildNarrativeUserPrompt,
  narrativeParagraphs,
  type NarrativeIssue,
} from "./narrative-editor"

const issue = (over: Partial<NarrativeIssue>): NarrativeIssue => ({
  kind: "tangent",
  severity: "medium",
  paragraph: 0,
  quote: "",
  fix: "cut",
  replacement: "",
  why: "",
  ...over,
})

describe("narrativeParagraphs", () => {
  it("keeps a credit in force until the next one, as the screen shows it", () => {
    const ps = narrativeParagraphs([
      { text: "a" },
      { text: "b", mark: { label: "L1", source: "S1", evidence: "E1" } },
      { text: "c" },
      { text: "d", mark: { label: "L2", source: "S2" } },
    ])
    expect(ps.map((p) => p.mark?.source ?? null)).toEqual([
      null,
      "S1",
      "S1",
      "S2",
    ])
    expect(ps[2].evidence).toBe("E1")
    // A credit with no evidence does not inherit the previous source's.
    expect(ps[3].evidence).toBeUndefined()
  })

  it("checks a returning source against its own evidence, not the last one shown", () => {
    const classic = { label: "Classic", source: "Ryle", evidence: "RYLE" }
    const language = { label: "Language", source: "Lexicon", evidence: "LEX" }
    const ps = narrativeParagraphs([
      { text: "a", role: "classic", mark: classic },
      { text: "b", role: "language", mark: language },
      // Credited once: the second classic paragraph carries no mark.
      { text: "c", role: "classic" },
      { text: "d", role: "reflection" },
    ])
    expect(ps[2].evidence).toBe("RYLE")
    expect(ps[2].mark?.source).toBe("Ryle")
    // A reflection paragraph keeps the old behaviour: the last credit shown.
    expect(ps[3].evidence).toBe("LEX")
  })
})

describe("applyNarrativeFixes", () => {
  it("cuts a sentence and tidies the spacing it leaves", () => {
    const { paragraphs, unapplied } = applyNarrativeFixes(
      [
        "A denarius was one day's wage. Roughly a soldier's pay. It fed a family.",
      ],
      [issue({ quote: "Roughly a soldier's pay." })],
    )
    expect(paragraphs[0]).toBe(
      "A denarius was one day's wage. It fed a family.",
    )
    expect(unapplied).toEqual([])
  })

  it("replaces the quoted words only", () => {
    const { paragraphs } = applyNarrativeFixes(
      ['"Evil eye" was a Hebrew idiom, and it had nothing to do with curses.'],
      [
        issue({
          kind: "planted-association",
          quote: ", and it had nothing to do with curses.",
          fix: "replace",
          replacement: " for a grudging look.",
        }),
      ],
    )
    expect(paragraphs[0]).toBe(
      '"Evil eye" was a Hebrew idiom for a grudging look.',
    )
  })

  it("returns a fix whose quote is not in the text, instead of guessing", () => {
    const i = issue({ quote: "words that are not there" })
    const { paragraphs, unapplied } = applyNarrativeFixes(["Unchanged."], [i])
    expect(paragraphs).toEqual(["Unchanged."])
    expect(unapplied).toEqual([i])
  })
})

describe("buildNarrativeUserPrompt", () => {
  it("numbers paragraphs from 0, names each credit, and lists evidence once per source", () => {
    const user = buildNarrativeUserPrompt({
      sceneTitle: "Workers in the vineyard",
      scripture: { reference: "Matthew 20:15", text: "Or are you envious?" },
      paragraphs: narrativeParagraphs([
        { text: "Own voice." },
        {
          text: "History.",
          mark: {
            label: "Historical context",
            source: "SBL",
            evidence: "SBL NOTES",
          },
        },
        { text: "More history." },
      ]),
      conclusion: "c",
      question: "q",
      prayer: "p",
      llm: { model: "x", complete: async () => ({}) as never },
    })
    expect(user).toContain("[0] (no credit")
    expect(user).toContain("[1] (credited on screen: HISTORICAL CONTEXT / SBL)")
    expect(user.match(/--- SBL ---/g)).toHaveLength(1)
    expect(user).toContain("SBL NOTES")
  })
})

describe("checkQuotations", () => {
  const RYLE =
    "This is to overthrow the whole teaching of the Bible. Whatever a believer " +
    "receives in the next world is a matter of grace, and not of debt. God is never a debtor."
  const para = (text: string) => ({
    text,
    mark: { label: "Commentary", source: "J. C. Ryle" },
    evidence: RYLE,
  })

  it("flags a quotation with the author's words dropped", () => {
    const issues = checkQuotations([
      para("One sentence from Ryle is worth carrying out of this:"),
      para(
        "Whatever a believer receives is a matter of grace, and not of debt.",
      ),
    ])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      kind: "misquote",
      severity: "high",
      paragraph: 1,
    })
  })

  it("passes the exact wording", () => {
    expect(
      checkQuotations([
        para("One sentence from Ryle is worth carrying out of this:"),
        para(
          "Whatever a believer receives in the next world is a matter of grace, and not of debt.",
        ),
      ]),
    ).toEqual([])
  })

  it("checks words in quotation marks inside a paragraph", () => {
    const issues = checkQuotations([
      para(
        'Ryle puts it plainly: "Whatever a believer receives is a matter of grace." And so on.',
      ),
    ])
    expect(issues.map((i) => i.kind)).toEqual(["misquote"])
  })

  it("leaves a quotation from elsewhere alone (no near match in the evidence)", () => {
    expect(
      checkQuotations([
        para(
          'Peter asked: "We have left everything to follow You. What then will there be for us?"',
        ),
      ]),
    ).toEqual([])
  })
})

describe("checkPlantedDenials", () => {
  it("flags a denial of an idea nobody raised", () => {
    const [i] = checkPlantedDenials([
      {
        text: '"Evil eye" was a Hebrew idiom, and it had nothing to do with curses or superstition. It meant a stingy look.',
      },
    ])
    expect(i).toMatchObject({ kind: "planted-association", fix: "cut" })
    expect(i.quote).toBe(
      ", and it had nothing to do with curses or superstition",
    )
  })

  it("leaves an argument's turn alone", () => {
    expect(
      checkPlantedDenials([
        {
          text: "So the question is not about a feeling the man could hide. It is about what his eyes do.",
        },
      ]),
    ).toEqual([])
  })
})
