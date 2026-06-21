import { describe, expect, it } from "vitest"

import {
  SEARCH_EVAL_SEED_PROMPT_LOCALES,
  SEARCH_EVAL_SEED_PROMPT_SET_VERSION,
  SEARCH_EVAL_SEED_PROMPTS,
  seedPromptsForLocales,
} from "./seed-prompt-set"

describe("search eval seed prompt set", () => {
  it("includes the first baseline examples with unique ids", () => {
    const queries = SEARCH_EVAL_SEED_PROMPTS.map((prompt) => prompt.queryText)
    for (const required of [
      "Bible Project",
      "Jesus",
      "Who is Jesus?",
      "videos for teens",
      "resources for parents",
      "new believer",
      "small group Bible study",
      "church leader training",
      "películas bíblicas para niños",
      "यीशु कौन हैं?",
      "Jesus em português",
      "Wer ist Jesus?",
      "Кто такой Иисус?",
      "من هو يسوع؟",
    ]) {
      expect(queries).toContain(required)
    }

    const ids = SEARCH_EVAL_SEED_PROMPTS.map((prompt) => prompt.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("keeps prompt metadata non-gating and locale-filterable", () => {
    expect(SEARCH_EVAL_SEED_PROMPT_SET_VERSION).toBe(
      "search-eval-seed-prompts/v4",
    )
    expect(
      SEARCH_EVAL_SEED_PROMPTS.every(
        (prompt) =>
          prompt.source === "seed" &&
          /^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(prompt.locale) &&
          /^[a-z0-9]+(-[a-z0-9]+)*$/.test(prompt.languageSlug ?? "") &&
          prompt.tags.length > 0,
      ),
    ).toBe(true)

    expect(
      seedPromptsForLocales(["fr"]).map((prompt) => prompt.locale),
    ).toEqual(["fr"])

    expect(SEARCH_EVAL_SEED_PROMPT_LOCALES).toEqual([
      "en",
      "es",
      "hi",
      "fr",
      "pt",
      "de",
      "ru",
      "ar",
    ])
  })

  it("includes website/watch locale mismatch cases", () => {
    const mismatches = SEARCH_EVAL_SEED_PROMPTS.filter(
      (prompt) =>
        prompt.websiteLocale != null && prompt.websiteLocale !== prompt.locale,
    )

    expect(mismatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "seed-spanish-castilian-children-bible-films",
          locale: "es",
          languageSlug: "spanish-castilian",
          websiteLocale: "en",
        }),
        expect.objectContaining({
          id: "seed-french-route-english-who-is-jesus",
          locale: "en",
          languageSlug: "english",
          websiteLocale: "fr",
        }),
      ]),
    )
  })
})
