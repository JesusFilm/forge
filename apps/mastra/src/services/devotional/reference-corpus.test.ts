import { describe, expect, it } from "vitest"

import {
  ancientEntry,
  entriesCiting,
  greekWords,
  osisSpan,
  verifyQuote,
  type ReferenceCorpora,
} from "./reference-corpus"

const corpora: ReferenceCorpora = {
  dictionaries: [
    {
      id: "e:Husk",
      term: "Husk",
      source: "Easton's Bible Dictionary (1897)",
      text: "In Luke 15:16, in the parable of the Prodigal Son, it designates the beans of the carob tree.",
      refs: ["Num.6.4", "Luke.15.16"],
    },
    {
      id: "e:Rich",
      term: "Rich",
      source: "Easton's Bible Dictionary (1897)",
      text: "Riches.",
      refs: ["Luke.16.19"],
    },
    {
      id: "s:Feast",
      term: "Feast",
      source: "Smith's Bible Dictionary (1863)",
      text: "Feasts.",
      refs: ["Luke.14.1-Luke.15.2"],
    },
  ],
  lexicon: {},
  lexiconSource: "test",
  ancient: {
    "Sir.19.30":
      "A man\u2019s attire, and excessive laughter, and gait, shew what he is.",
    "Sir.33.19":
      "Give not thy son and wife, thy brother and friend, power over thee while thou livest, and give not thy goods to another.",
    "Sir.33.20":
      "As long as thou livest and hast breath in thee, give not thyself over to any.",
  },
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
    {
      osis: "Luke.16.1",
      n: 1,
      greek: "Ἔλεγεν",
      translit: "elegen",
      english: "he was saying",
      strong: "G3004",
      lemma: "λέγω",
      gloss: "to speak",
    },
  ],
}

describe("reference corpus lookups", () => {
  it("finds entries that cite the passage, and only those", () => {
    const terms = entriesCiting(corpora, "Luke.15.11-Luke.15.32").map(
      (e) => e.term,
    )
    expect(terms).toEqual(["Husk"])
  })

  it("counts a cited range that overlaps the passage", () => {
    const terms = entriesCiting(corpora, "Luke.15.1-Luke.15.10").map(
      (e) => e.term,
    )
    expect(terms).toEqual(["Feast"])
  })

  it("returns the passage's Greek words only", () => {
    expect(
      greekWords(corpora, "Luke.15.11-Luke.15.32").map((w) => w.strong),
    ).toEqual(["G4697"])
  })

  it("reads a whole-chapter span", () => {
    expect(osisSpan("Luke.15")).toEqual({
      book: "Luke",
      from: 15000,
      to: 15999,
    })
  })
})

describe("verifyQuote", () => {
  const text = corpora.dictionaries[0].text
  it("accepts a verbatim run despite case, spacing and punctuation", () => {
    expect(verifyQuote("it designates the BEANS of the carob tree", text)).toBe(
      true,
    )
    expect(
      verifyQuote("the parable of the Prodigal Son,  it designates", text),
    ).toBe(true)
  })
  it("ignores curly quotation marks in the source (Easton, Calf)", () => {
    const easton =
      "The “fatted calf” was regarded as the choicest of animal food; it was"
    expect(
      verifyQuote(
        "The fatted calf was regarded as the choicest of animal food",
        easton,
      ),
    ).toBe(true)
    expect(
      verifyQuote("the 'fatted calf' was regarded as the choicest", easton),
    ).toBe(true)
  })
  it("reads past Scripture citations in parentheses (Easton, Ring)", () => {
    const ring =
      "Rings were used as a signet (Gen. 38:18). They were given as a token of investment with authority (Gen. 41:42; Esther 3:8-10; 8:2), and of favour and dignity (Luke 15:22)."
    expect(
      verifyQuote(
        "They were given as a token of investment with authority, and of favour and dignity",
        ring,
      ),
    ).toBe(true)
  })
  it("keeps apostrophes inside words", () => {
    expect(
      verifyQuote(
        "the landowner’s last line is softened",
        "The landowner's last line is softened in English.",
      ),
    ).toBe(true)
  })
  it("rejects a one-word substitution", () => {
    expect(verifyQuote("it designates the pods of the carob tree", text)).toBe(
      false,
    )
  })
  it("rejects fragments too short to mean anything", () => {
    expect(verifyQuote("carob tree", text)).toBe(false)
  })
  it("does not match across word boundaries", () => {
    expect(verifyQuote("designates the beans of the carob tre", text)).toBe(
      false,
    )
  })
})

describe("ancientEntry", () => {
  it("joins a verse range into one quotable entry", () => {
    const e = ancientEntry(corpora, "Sir.33.19-Sir.33.20")
    expect(e?.id).toBe("Sirach 33:19-20")
    expect(verifyQuote("give not thy goods to another", e!.text)).toBe(true)
    expect(verifyQuote("thou livest and hast breath in thee", e!.text)).toBe(
      true,
    )
  })
  it("refuses a range with a missing verse", () => {
    expect(ancientEntry(corpora, "Sir.33.19-Sir.33.21")).toBeNull()
  })
  it("names a single verse", () => {
    expect(ancientEntry(corpora, "Sir.19.30")?.id).toBe("Sirach 19:30")
  })
})
