import { describe, expect, it } from "vitest"

import {
  SEARCH_EVAL_SEED_PROMPT_LOCALES,
  SEARCH_EVAL_SEED_PROMPT_SET_VERSION,
  SEARCH_EVAL_SEED_PROMPTS,
  seedPromptsForLocales,
} from "./seed-prompt-set"

describe("search eval seed prompt set", () => {
  it("includes a 100-query launch-readiness suite with unique ids", () => {
    const publicWatchPrompts = seedPromptsForLocales(undefined, {
      callerTrack: "public-watch",
    })
    expect(publicWatchPrompts).toHaveLength(100)
    expect(SEARCH_EVAL_SEED_PROMPTS.length).toBeGreaterThan(100)

    const ids = SEARCH_EVAL_SEED_PROMPTS.map((prompt) => prompt.id)
    expect(new Set(ids).size).toBe(ids.length)

    const queryLocales = SEARCH_EVAL_SEED_PROMPTS.map(
      (prompt) =>
        `${prompt.queryText.toLocaleLowerCase()}|${prompt.locale}|${
          prompt.websiteLocale ?? ""
        }`,
    )
    expect(new Set(queryLocales).size).toBe(queryLocales.length)
  })

  it("keeps the high-traffic Algolia baseline and legacy smoke prompts", () => {
    expect(SEARCH_EVAL_SEED_PROMPTS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "seed-jesus",
          queryText: "jesus",
          tags: expect.arrayContaining(["algolia-top-search", "product-title"]),
          operatorNotes: expect.stringContaining("count=88"),
        }),
        expect.objectContaining({
          id: "seed-bible-project",
          queryText: "bible project",
          tags: expect.arrayContaining(["brand-intent", "product-title"]),
          operatorNotes: expect.stringContaining("Bible Project videos"),
        }),
        expect.objectContaining({
          id: "seed-who-is-jesus",
          queryText: "Who is Jesus?",
        }),
        expect.objectContaining({
          id: "seed-videos-for-teens",
          queryText: "videos for teens",
        }),
        expect.objectContaining({
          id: "seed-resources-for-parents",
          queryText: "resources for parents",
        }),
        expect.objectContaining({
          id: "seed-new-believer",
          queryText: "new believer",
        }),
        expect.objectContaining({
          id: "seed-small-group-bible-study",
          queryText: "small group Bible study",
        }),
        expect.objectContaining({
          id: "seed-church-leader-training",
          queryText: "church leader training",
        }),
      ]),
    )
  })

  it("covers every readiness category called out by the roadmap ticket", () => {
    const tags = [
      ...new Set(SEARCH_EVAL_SEED_PROMPTS.flatMap((prompt) => prompt.tags)),
    ]

    expect(tags).toEqual(
      expect.arrayContaining([
        "algolia-top-search",
        "algolia-no-result",
        "product-title",
        "felt-need",
        "bible-topic",
        "misspelling",
        "synonym",
        "confusing",
        "multilingual",
        "scene-like",
      ]),
    )
  })

  it("includes Algolia no-result typo and confusing-query regressions", () => {
    expect(SEARCH_EVAL_SEED_PROMPTS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "seed-walking-wih-jesus",
          queryText: "walking wih jesus",
          tags: expect.arrayContaining(["algolia-no-result", "misspelling"]),
        }),
        expect.objectContaining({
          id: "seed-walking-wth-jesus",
          queryText: "walking wth jesus",
          tags: expect.arrayContaining(["algolia-no-result", "misspelling"]),
        }),
        expect.objectContaining({
          id: "seed-jrius-daughter",
          queryText: "jrius daughter",
          tags: expect.arrayContaining(["misspelling", "scene-like"]),
        }),
        expect.objectContaining({
          id: "seed-finding-hope-heavy",
          queryText: "finding hope when life feels heavy",
          tags: expect.arrayContaining(["algolia-no-result", "felt-need"]),
        }),
        expect.objectContaining({
          id: "seed-world-cup-2026-outreach",
          queryText: "world cup 2026 outreach",
          tags: expect.arrayContaining(["algolia-no-result", "confusing"]),
        }),
      ]),
    )
  })

  it("keeps prompt metadata non-gating and locale-filterable", () => {
    expect(SEARCH_EVAL_SEED_PROMPT_SET_VERSION).toBe(
      "search-eval-seed-prompts/v5",
    )
    expect(
      SEARCH_EVAL_SEED_PROMPTS.every(
        (prompt) =>
          prompt.source === "seed" &&
          prompt.callerTracks.length > 0 &&
          /^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(prompt.locale) &&
          (prompt.languageSlug == null ||
            /^[a-z0-9]+(-[a-z0-9]+)*$/.test(prompt.languageSlug)) &&
          prompt.tags.length > 0,
      ),
    ).toBe(true)

    expect(
      seedPromptsForLocales(["fr"]).map((prompt) => prompt.locale),
    ).toEqual(["fr"])

    expect(
      seedPromptsForLocales(undefined, {
        callerTrack: "ai-experience-generation",
      }).map((prompt) => prompt.id),
    ).toEqual(
      expect.arrayContaining([
        "seed-ai-easter-devotional-hope",
        "seed-ai-pentecost-holy-spirit",
      ]),
    )

    expect(
      seedPromptsForLocales(undefined, {
        callerTrack: "semantic-diagnostic",
      }).map((prompt) => prompt.id),
    ).toEqual(
      expect.arrayContaining([
        "seed-semantic-lost-son-welcomed-home",
        "seed-semantic-wedding-water-wine",
      ]),
    )

    expect(SEARCH_EVAL_SEED_PROMPT_LOCALES).toEqual(
      expect.arrayContaining([
        "en",
        "es",
        "hi",
        "fr",
        "pt",
        "de",
        "ru",
        "ar",
        "th",
        "zh",
      ]),
    )
  })

  it("includes website/watch locale mismatch and non-Latin multilingual cases", () => {
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

    expect(SEARCH_EVAL_SEED_PROMPTS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "seed-russian-who-is-jesus",
          locale: "ru",
          languageSlug: "russian",
        }),
        expect.objectContaining({
          id: "seed-arabic-who-is-jesus",
          locale: "ar",
          languageSlug: "arabic-modern-standard",
        }),
        expect.objectContaining({
          id: "seed-chinese-vegetable-animation",
          locale: "zh",
          languageSlug: "mandarin-china",
        }),
      ]),
    )
  })
})
