import type { SeedPromptCase } from "./types"

export const SEARCH_EVAL_SEED_PROMPT_SET_VERSION = "search-eval-seed-prompts/v1"

export const SEARCH_EVAL_SEED_PROMPTS: readonly SeedPromptCase[] = [
  {
    id: "seed-bible-project",
    locale: "en",
    queryText: "Bible Project",
    source: "seed",
    tags: ["catalog", "brand-intent"],
    operatorNotes: "Operator comment only; not expected-result truth.",
  },
  {
    id: "seed-jesus",
    locale: "en",
    queryText: "Jesus",
    source: "seed",
    tags: ["core-title", "catalog"],
  },
  {
    id: "seed-who-is-jesus",
    locale: "en",
    queryText: "Who is Jesus?",
    source: "seed",
    tags: ["question", "new-believer"],
  },
  {
    id: "seed-videos-for-teens",
    locale: "en",
    queryText: "videos for teens",
    source: "seed",
    tags: ["audience", "teens"],
  },
  {
    id: "seed-resources-for-parents",
    locale: "en",
    queryText: "resources for parents",
    source: "seed",
    tags: ["audience", "parents"],
  },
  {
    id: "seed-new-believer",
    locale: "en",
    queryText: "new believer",
    source: "seed",
    tags: ["discipleship", "new-believer"],
  },
  {
    id: "seed-small-group-bible-study",
    locale: "en",
    queryText: "small group Bible study",
    source: "seed",
    tags: ["ministry", "small-group"],
  },
  {
    id: "seed-church-leader-training",
    locale: "en",
    queryText: "church leader training",
    source: "seed",
    tags: ["ministry", "leaders"],
  },
  {
    id: "seed-spanish-jesus",
    locale: "es",
    queryText: "Jesus en espanol",
    source: "seed",
    tags: ["locale", "core-title"],
  },
  {
    id: "seed-french-hope-youth",
    locale: "fr",
    queryText: "videos d'espoir pour les jeunes",
    source: "seed",
    tags: ["locale", "audience", "youth"],
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
