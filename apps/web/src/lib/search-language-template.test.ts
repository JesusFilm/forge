import { describe, expect, it } from "vitest"
import arMessages from "../../messages/ar.json"
import enMessages from "../../messages/en.json"
import heMessages from "../../messages/he.json"
import jaMessages from "../../messages/ja.json"
import mtMessages from "../../messages/mt.json"
import amMessages from "../../messages/am.json"
import fiMessages from "../../messages/fi.json"
import trMessages from "../../messages/tr.json"
import huMessages from "../../messages/hu.json"
import {
  splitSearchLanguageTemplate,
  type SearchLanguageTemplateSegment,
} from "./search-language-template"

const LANGUAGE = ["{language}"] as const
const BOTH = ["{language}", "{suggestion}"] as const

function languageSegment(template: string, tokens: readonly string[] = BOTH) {
  const segment = splitSearchLanguageTemplate(template, tokens).find(
    (candidate) =>
      candidate.kind === "placeholder" && candidate.token === "{language}",
  )
  if (segment?.kind !== "placeholder") {
    throw new Error(`No {language} placeholder in ${template}`)
  }
  return { start: segment.attachedStart, end: segment.attachedEnd }
}

describe("splitSearchLanguageTemplate", () => {
  it("splits into ordered text and placeholder segments without empties", () => {
    expect(
      splitSearchLanguageTemplate("Search in {language}", LANGUAGE),
    ).toEqual([
      { kind: "text", text: "Search in " },
      {
        kind: "placeholder",
        token: "{language}",
        attachedStart: false,
        attachedEnd: false,
      },
    ] satisfies SearchLanguageTemplateSegment[])
  })

  it("returns plain text when the template has no placeholder", () => {
    expect(splitSearchLanguageTemplate("Search", LANGUAGE)).toEqual([
      { kind: "text", text: "Search" },
    ])
  })

  it("treats whitespace on both sides as detached (the default word boundary)", () => {
    expect(languageSegment("Search in {language} now")).toEqual({
      start: false,
      end: false,
    })
  })

  it("attaches a leading clitic on the inline-start side only", () => {
    expect(languageSegment("ب{language}", LANGUAGE)).toEqual({
      start: true,
      end: false,
    })
  })

  it("attaches a trailing particle on the inline-end side only", () => {
    expect(languageSegment("{language}で検索", LANGUAGE)).toEqual({
      start: false,
      end: true,
    })
  })

  it("attaches both sides when copy touches the placeholder on both", () => {
    expect(languageSegment("ب{language}ة", LANGUAGE)).toEqual({
      start: true,
      end: true,
    })
  })

  it("treats punctuation glued to the placeholder as attached", () => {
    expect(languageSegment("Language: {language}.", LANGUAGE)).toEqual({
      start: false,
      end: true,
    })
    expect(languageSegment("({language})", LANGUAGE)).toEqual({
      start: true,
      end: true,
    })
  })

  it("treats every Unicode whitespace as a boundary, including NBSP", () => {
    expect(languageSegment("foo {language} bar", LANGUAGE)).toEqual({
      start: false,
      end: false,
    })
  })

  it("looks through invisible bidi controls when judging the boundary", () => {
    // A space followed by RLM is still a real space before the placeholder.
    expect(languageSegment("foo ‏{language}‏ bar", LANGUAGE)).toEqual({
      start: false,
      end: false,
    })
    // An RLM between a clitic and the placeholder does not detach it.
    expect(languageSegment("ب‏{language}", LANGUAGE)).toEqual({
      start: true,
      end: false,
    })
  })

  it("keeps scanning past text that holds only bidi controls", () => {
    // RLM-only text between two placeholders is not a boundary: the second
    // placeholder is still glued to the first.
    expect(languageSegment("{suggestion}\u200f{language}")).toEqual({
      start: true,
      end: false,
    })
    // Bidi-only text at the template edge leaves nothing to be glued to.
    expect(languageSegment("\u200f{language}", LANGUAGE)).toEqual({
      start: false,
      end: false,
    })
    // Bidi-only text, then a real space: still a word boundary.
    expect(languageSegment("a \u200f\u200f{language}", LANGUAGE)).toEqual({
      start: false,
      end: false,
    })
  })

  it("returns the whole template as text when no tokens are given", () => {
    expect(splitSearchLanguageTemplate("ب{language}", [])).toEqual([
      { kind: "text", text: "ب{language}" },
    ])
  })

  it("treats a placeholder directly next to another placeholder as attached", () => {
    expect(languageSegment("{suggestion}{language}")).toEqual({
      start: true,
      end: false,
    })
  })

  it("flags attachment per placeholder when several tokens are present", () => {
    const segments = splitSearchLanguageTemplate(
      "ابحث عن «{suggestion}» ب{language}",
      BOTH,
    )
    const placeholders = segments.filter(
      (segment) => segment.kind === "placeholder",
    )
    expect(placeholders).toEqual([
      {
        kind: "placeholder",
        token: "{suggestion}",
        attachedStart: true,
        attachedEnd: true,
      },
      {
        kind: "placeholder",
        token: "{language}",
        attachedStart: true,
        attachedEnd: false,
      },
    ])
  })

  it("matches repeated placeholders independently", () => {
    const segments = splitSearchLanguageTemplate(
      "{language} / x{language}",
      LANGUAGE,
    ).filter((segment) => segment.kind === "placeholder")
    expect(
      segments.map((s) => s.kind === "placeholder" && s.attachedStart),
    ).toEqual([false, true])
  })
})

/**
 * Pinned against the real shipped catalogs: these are the production inputs
 * the helper exists for (QA finding N59). A template reword that moves a boundary should
 * be a deliberate, reviewed change, not a silent layout regression.
 */
describe("shipped search templates", () => {
  const keys = [
    "searchInLanguage",
    "searchingInLanguage",
    "searchSuggestionWithLanguage",
  ] as const

  function template(
    messages: { SearchOverlay: Record<string, string> },
    key: (typeof keys)[number],
  ) {
    return messages.SearchOverlay[key]
  }

  it.each([
    ["ar", arMessages, { start: true, end: false }],
    ["he (ב־ with maqaf)", heMessages, { start: true, end: false }],
    ["am (በ prefix)", amMessages, { start: true, end: false }],
  ])("%s keeps the prefix glued to the chip", (_name, messages, expected) => {
    for (const key of keys) {
      expect(languageSegment(template(messages, key))).toEqual(expected)
    }
  })

  it("ja keeps the postposition glued to the chip in every template", () => {
    for (const key of keys) {
      expect(languageSegment(template(jaMessages, key))).toEqual({
        start: false,
        end: true,
      })
    }
  })

  it("mt keeps the hyphenated article glued to the chip in every template", () => {
    for (const key of keys) {
      expect(languageSegment(template(mtMessages, key))).toEqual({
        start: true,
        end: false,
      })
    }
  })

  it("en keeps normal word gaps on both sides in every template", () => {
    for (const key of keys) {
      expect(languageSegment(template(enMessages, key))).toEqual({
        start: false,
        end: false,
      })
    }
  })

  it.each([
    ["tr", trMessages],
    ["hu", huMessages],
    ["fi", fiMessages],
  ])(
    "%s separates the chip from neighbouring words (suffix languages whose catalogs use a space)",
    (_name, messages) => {
      // These suffix-heavy languages spell the affix as a separate word or
      // after a colon/dash in the shipped catalogs, so the chip keeps the
      // default gap. Guards against over-attaching on any non-letter boundary.
      for (const key of keys) {
        expect(languageSegment(template(messages, key))).toEqual({
          start: false,
          end: false,
        })
      }
    },
  )
})
