import { describe, expect, it, vi } from "vitest"

import { buildParagraphs } from "./compose-message-first"
import {
  DepthConflictError,
  researchContext,
  researchLanguage,
} from "./depth-research"
import type { DevotionalMessage } from "./devotional-message"
import type { DevotionalLlm } from "./llm"
import { foreignWords } from "./message-first-writer"
import type { ReferenceCorpora } from "./reference-corpus"

const message: DevotionalMessage = {
  idea: "The father's welcome comes from who he is.",
  tension: "The older brother's complaint sounds fair.",
  askDirection: "Where the viewer keeps score.",
  grounding: "Luke 15:20, 15:31-32.",
  classicPoints: [1],
}

const corpora: ReferenceCorpora = {
  dictionaries: [
    {
      id: "Easton:Calf",
      term: "Calf",
      source: "Easton's Bible Dictionary (1897)",
      text: "The “fatted calf” was regarded as the choicest of animal food; it was frequently also offered as a special sacrifice (1 Sam. 28:24; Amos 6:4; Luke 15:23).",
      refs: ["Luke.15.23"],
    },
  ],
  lexicon: {
    G4697: {
      strong: "G4697",
      lemma: "σπλαγχνίζω",
      translit: "splagchnizō",
      gloss: "to pity",
      text: "to be moved as to the σπλάγχνα (which see), hence, to feel pity or compassion: absol., Luk.10:33 15:20",
    },
  },
  lexiconSource: "test",
  greek: [
    {
      osis: "Luke.15.20",
      n: 19,
      greek: "ἐσπλαγχνίσθη",
      translit: "esplagchnisthē",
      english: "was moved with compassion",
      strong: "G4697",
      lemma: "σπλαγχνίζω",
      gloss: "to pity",
    },
  ],
}

/** An LLM that answers each call in turn from `replies`. */
const scripted = (
  ...replies: unknown[]
): DevotionalLlm & { complete: ReturnType<typeof vi.fn> } => {
  const complete = vi.fn()
  for (const r of replies) complete.mockResolvedValueOnce(r)
  return { model: "fake", complete } as never
}

const base = {
  corpora,
  passageOsis: "Luke.15.11-Luke.15.32",
  passageReference: "Luke 15:11-32",
  passageText:
    "But while he was still in the distance, his father saw him and was filled with compassion.",
  message,
}

describe("researchContext", () => {
  it("keeps a fact whose quote is in the entry, as the audit narrows it", async () => {
    const llm = scripted(
      {
        status: "facts",
        reason: "",
        facts: [
          {
            claim: "The calf was the best food, a royal honour.",
            quote:
              "the fatted calf was regarded as the choicest of animal food",
            entryId: "Easton:Calf",
            why: "scale",
          },
        ],
      },
      {
        verdicts: [
          {
            entryId: "Easton:Calf",
            supported: true,
            claim: "The fatted calf was the choicest of animal food.",
          },
        ],
      },
    )
    const out = await researchContext({ ...base, llm })
    expect(out.status).toBe("facts")
    expect(out.facts[0].claim).toBe(
      "The fatted calf was the choicest of animal food.",
    )
  })

  it("drops a fact whose quote is not in the entry, after one more try", async () => {
    const invented = {
      claim: "A patriarch never ran.",
      quote: "a man of his age and position did not run",
      entryId: "Easton:Calf",
      why: "",
    }
    const llm = scripted(
      { status: "facts", reason: "", facts: [invented] },
      { status: "facts", reason: "", facts: [invented] },
    )
    const out = await researchContext({ ...base, llm })
    expect(out).toMatchObject({ status: "nothing-useful", facts: [] })
    expect(llm.complete).toHaveBeenCalledTimes(2)
  })

  it("drops a real quote dressed with a claim the entry does not make", async () => {
    const llm = scripted(
      {
        status: "facts",
        reason: "",
        facts: [
          {
            claim: "Killing the calf shamed the older son.",
            quote:
              "the fatted calf was regarded as the choicest of animal food",
            entryId: "Easton:Calf",
            why: "",
          },
        ],
      },
      { verdicts: [{ entryId: "Easton:Calf", supported: false, claim: "" }] },
    )
    expect((await researchContext({ ...base, llm })).facts).toEqual([])
  })

  it("stops the run when the passage pulls against the message", async () => {
    const llm = scripted({
      status: "conflict",
      reason: "the parable is about the older son",
      facts: [],
    })
    await expect(researchContext({ ...base, llm })).rejects.toBeInstanceOf(
      DepthConflictError,
    )
  })
})

describe("researchLanguage", () => {
  const pick = (over: Record<string, string>) => ({
    status: "facts",
    reason: "",
    strong: "G4697",
    osis: "Luke.15.20",
    englishPhrase: "was filled with compassion",
    meaning: "moved with compassion",
    quote: "to be moved as to the σπλάγχνα which see hence to feel pity",
    why: "",
    ...over,
  })

  it("keeps a word that is in the passage with a verbatim quote", async () => {
    const out = await researchLanguage({ ...base, llm: scripted(pick({})) })
    expect(out.note).toMatchObject({
      strong: "G4697",
      osis: "Luke.15.20",
      verseRef: "Luke 15:20",
      englishPhrase: "was filled with compassion",
    })
  })

  it("drops a note whose English words are not in the passage", async () => {
    const out = await researchLanguage({
      ...base,
      llm: scripted(pick({ englishPhrase: "his heart went out to him" })),
    })
    expect(out.status).toBe("nothing-useful")
  })

  it("drops a word that is not in the passage", async () => {
    const out = await researchLanguage({
      ...base,
      llm: scripted(pick({ osis: "Luke.15.24" })),
    })
    expect(out.status).toBe("nothing-useful")
  })

  it("answers nothing-useful without inventing a note", async () => {
    const out = await researchLanguage({
      ...base,
      llm: scripted({
        status: "nothing-useful",
        reason: "no word changes the reading",
        strong: "",
        osis: "",
        meaning: "",
        quote: "",
        why: "",
      }),
    })
    expect(out).toEqual({
      status: "nothing-useful",
      reason: "no word changes the reading",
    })
  })
})

describe("buildParagraphs", () => {
  it("credits each section once where it starts, with the second voice for history and language", () => {
    const out = buildParagraphs(
      [
        { role: "reflection", text: "Notice the father." },
        { role: "language", text: "The Greek word is esplagchnisthē." },
        { role: "language", text: "It is compassion." },
        { role: "classic", text: "Ryle says it plainly." },
        { role: "reflection", text: "So the question is ours." },
      ],
      {
        voices: { main: "female-c", depth: "male-e" },
        context: [],
        language: {
          englishPhrase: "was filled with compassion",
          verseRef: "Luke 15:20",
          strong: "G4697",
          osis: "Luke.15.20",
          greek: "",
          translit: "esplagchnisthē",
          lemma: "σπλαγχνίζω",
          meaning: "",
          quote: "",
          why: "",
          lexiconText: "to be moved",
        },
        classic: { credit: "J. C. Ryle (1816–1900)", evidence: "Ryle's text" },
        corpora,
      },
    )
    expect(out.map((p) => p.mark?.label ?? null)).toEqual([
      null,
      "Original language",
      null,
      "Commentary",
      null,
    ])
    expect(out.map((p) => p.voice)).toEqual([
      "female-c",
      "male-e",
      "male-e",
      "female-c",
      "female-c",
    ])
    expect(out.map((p) => p.role)).toEqual([
      "reflection",
      "language",
      "language",
      "classic",
      "reflection",
    ])
  })
})

describe("foreignWords", () => {
  const note = {
    englishPhrase: "was filled with compassion",
    verseRef: "Luke 15:20",
    strong: "G4697",
    osis: "Luke.15.20",
    greek: "ἐσπλαγχνίσθη",
    translit: "esplagchnisthē",
    lemma: "σπλαγχνίζω",
    meaning: "",
    quote: "",
    why: "",
    lexiconText: "",
  }
  it("catches the Greek word said aloud, in Greek or in Latin letters", () => {
    expect(
      foreignWords("The Greek word is esplagchnisthē. It is deep.", note),
    ).toHaveLength(1)
    expect(foreignWords("Luke writes ἐσπλαγχνίσθη here.", note)).toHaveLength(1)
  })
  it("lets the English pointing through", () => {
    expect(
      foreignWords(
        "In verse 20 the father was filled with compassion. The word Luke uses means to feel pity.",
        note,
      ),
    ).toEqual([])
  })
})
