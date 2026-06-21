import type { SeedPromptCase } from "./types"

export const SEARCH_EVAL_SEED_PROMPT_SET_VERSION = "search-eval-seed-prompts/v4"

export const SEARCH_EVAL_SEED_PROMPTS: readonly SeedPromptCase[] = [
  {
    id: "seed-bible-project",
    locale: "en",
    languageSlug: "english",
    queryText: "Bible Project",
    source: "seed",
    tags: ["catalog", "brand-intent"],
    operatorNotes: "Operator comment only; not expected-result truth.",
  },
  {
    id: "seed-jesus",
    locale: "en",
    languageSlug: "english",
    queryText: "Jesus",
    source: "seed",
    tags: ["core-title", "catalog"],
  },
  {
    id: "seed-who-is-jesus",
    locale: "en",
    languageSlug: "english",
    queryText: "Who is Jesus?",
    source: "seed",
    tags: ["question", "new-believer"],
  },
  {
    id: "seed-videos-for-teens",
    locale: "en",
    languageSlug: "english",
    queryText: "videos for teens",
    source: "seed",
    tags: ["audience", "teens"],
  },
  {
    id: "seed-resources-for-parents",
    locale: "en",
    languageSlug: "english",
    queryText: "resources for parents",
    source: "seed",
    tags: ["audience", "parents"],
  },
  {
    id: "seed-new-believer",
    locale: "en",
    languageSlug: "english",
    queryText: "new believer",
    source: "seed",
    tags: ["discipleship", "new-believer"],
  },
  {
    id: "seed-small-group-bible-study",
    locale: "en",
    languageSlug: "english",
    queryText: "small group Bible study",
    source: "seed",
    tags: ["ministry", "small-group"],
  },
  {
    id: "seed-church-leader-training",
    locale: "en",
    languageSlug: "english",
    queryText: "church leader training",
    source: "seed",
    tags: ["ministry", "leaders"],
  },
  {
    id: "seed-spanish-jesus",
    locale: "es",
    languageSlug: "spanish-castilian",
    queryText: "Jesus en espanol",
    source: "seed",
    tags: ["locale", "core-title"],
  },
  {
    id: "seed-spanish-castilian-children-bible-films",
    locale: "es",
    languageSlug: "spanish-castilian",
    websiteLocale: "en",
    queryText: "películas bíblicas para niños",
    source: "seed",
    tags: ["locale", "semantic-language", "children", "mismatch"],
    operatorNotes:
      "Exercises Spanish semantic search language selection from an English website/watch route.",
  },
  {
    id: "seed-hindi-who-is-jesus",
    locale: "hi",
    languageSlug: "hindi",
    queryText: "यीशु कौन हैं?",
    source: "seed",
    tags: ["locale", "semantic-language", "question", "new-believer"],
    operatorNotes:
      "Exercises non-Latin typed-query language detection and Hindi semantic search language selection.",
  },
  {
    id: "seed-french-route-english-who-is-jesus",
    locale: "en",
    languageSlug: "english",
    websiteLocale: "fr",
    queryText: "Who is Jesus?",
    source: "seed",
    tags: ["question", "semantic-language", "mismatch"],
    operatorNotes:
      "Exercises English semantic search language selection from a French website/watch route.",
  },
  {
    id: "seed-french-hope-youth",
    locale: "fr",
    languageSlug: "french",
    queryText: "videos d'espoir pour les jeunes",
    source: "seed",
    tags: ["locale", "audience", "youth"],
  },
  {
    id: "seed-portuguese-jesus",
    locale: "pt",
    languageSlug: "portuguese-brazil",
    queryText: "Jesus em português",
    source: "seed",
    tags: ["locale", "core-title"],
  },
  {
    id: "seed-german-who-is-jesus",
    locale: "de",
    languageSlug: "german-standard",
    queryText: "Wer ist Jesus?",
    source: "seed",
    tags: ["locale", "question", "new-believer"],
  },
  {
    id: "seed-russian-who-is-jesus",
    locale: "ru",
    languageSlug: "russian",
    queryText: "Кто такой Иисус?",
    source: "seed",
    tags: ["locale", "question", "new-believer"],
  },
  {
    id: "seed-arabic-who-is-jesus",
    locale: "ar",
    languageSlug: "arabic-modern-standard",
    queryText: "من هو يسوع؟",
    source: "seed",
    tags: ["locale", "question", "new-believer"],
  },
] as const

export const SEARCH_EVAL_SEED_PROMPT_LOCALES = [
  ...new Set(SEARCH_EVAL_SEED_PROMPTS.map((prompt) => prompt.locale)),
] as const

export function seedPromptsForLocales(locales?: readonly string[]) {
  if (locales == null || locales.length === 0) {
    return [...SEARCH_EVAL_SEED_PROMPTS]
  }
  const allowed = new Set(locales)
  return SEARCH_EVAL_SEED_PROMPTS.filter((prompt) => allowed.has(prompt.locale))
}
