import { describe, expect, it } from "vitest"

import {
  WATCH_SEARCH_COMMON_PHRASE_QRELS_REVISION,
  WATCH_SEARCH_INTENT_EVAL_CASES,
  WatchSearchCandidateEvalConfigurationError,
  validateWatchSearchCandidateEvalCases,
} from "./watch-search-candidate-intent-eval-cases"

describe("Watch search Candidate intent evaluation cases", () => {
  it("owns a versioned, public-slug common-phrase judgment set", () => {
    expect(WATCH_SEARCH_COMMON_PHRASE_QRELS_REVISION).toMatch(
      /^watch-search-common-phrases\/v\d+$/,
    )
    expect(WATCH_SEARCH_INTENT_EVAL_CASES.map(({ query }) => query)).toEqual([
      "Jesus for kids",
      "Jesus for children",
      "resurrection",
      "forgiveness",
      "prayer",
      "anxiety",
      "Christmas",
      "prodigal son",
      "who is Jesus",
      "life after death",
    ])
    expect(
      WATCH_SEARCH_INTENT_EVAL_CASES.every(
        ({ track, languageSlug, judgment }) =>
          track === "intent-query" &&
          languageSlug === "english" &&
          judgment.allowedAvailabilityKinds.includes("target_audio") &&
          judgment.allowedLanguageSlugs.includes("english"),
      ),
    ).toBe(true)
    expect(JSON.stringify(WATCH_SEARCH_INTENT_EVAL_CASES)).not.toMatch(
      /cmp[0-9a-z]{20,}/,
    )
  })

  it.each([
    ["missing cases", []],
    [
      "duplicate case ids",
      [
        WATCH_SEARCH_INTENT_EVAL_CASES[0],
        { ...WATCH_SEARCH_INTENT_EVAL_CASES[1], id: "jesus-for-kids" },
      ],
    ],
    [
      "duplicate normalized queries",
      [
        WATCH_SEARCH_INTENT_EVAL_CASES[0],
        { ...WATCH_SEARCH_INTENT_EVAL_CASES[1], query: " JESUS FOR KIDS " },
      ],
    ],
    [
      "duplicate expected and alternate slugs",
      [
        {
          ...WATCH_SEARCH_INTENT_EVAL_CASES[0],
          judgment: {
            ...WATCH_SEARCH_INTENT_EVAL_CASES[0].judgment,
            acceptableCanonicalSlugs: ["the-story-of-jesus-for-children"],
          },
        },
      ],
    ],
    [
      "invalid maximum rank",
      [
        {
          ...WATCH_SEARCH_INTENT_EVAL_CASES[0],
          judgment: {
            ...WATCH_SEARCH_INTENT_EVAL_CASES[0].judgment,
            maxRank: 0,
          },
        },
      ],
    ],
    [
      "missing allowed availability",
      [
        {
          ...WATCH_SEARCH_INTENT_EVAL_CASES[0],
          judgment: {
            ...WATCH_SEARCH_INTENT_EVAL_CASES[0].judgment,
            allowedAvailabilityKinds: [],
          },
        },
      ],
    ],
    [
      "missing allowed content types",
      [
        {
          ...WATCH_SEARCH_INTENT_EVAL_CASES[0],
          judgment: {
            ...WATCH_SEARCH_INTENT_EVAL_CASES[0].judgment,
            allowedContentTypes: [],
          },
        },
      ],
    ],
    [
      "missing allowed languages",
      [
        {
          ...WATCH_SEARCH_INTENT_EVAL_CASES[0],
          judgment: {
            ...WATCH_SEARCH_INTENT_EVAL_CASES[0].judgment,
            allowedLanguageSlugs: [],
          },
        },
      ],
    ],
  ] as const)("rejects %s", (_label, cases) => {
    expect(() => validateWatchSearchCandidateEvalCases(cases)).toThrow(
      WatchSearchCandidateEvalConfigurationError,
    )
  })
})
