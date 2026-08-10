import { seedPromptsForLocales } from "./seed-prompt-set"
import type { SeedPromptCase } from "./types"

export const ABSOLUTE_PUBLIC_WATCH_QUERY_SET_VERSION =
  "public-watch-absolute/v2" as const

export type AbsoluteSearchEvalSplit = "development" | "held-out"
export type AbsoluteSearchIntent =
  | "product-title"
  | "metadata-topic"
  | "semantic-intent"
  | "typo-recovery"
  | "confusing-or-no-result"

export type AbsolutePublicWatchQueryCase = SeedPromptCase & {
  split: AbsoluteSearchEvalSplit
  intent: AbsoluteSearchIntent
  expectedNoResult: boolean
  multilingual: boolean
}

// Changing membership requires a query-set version bump so tuning cannot move a
// difficult case out of the release-only partition.
const HELD_OUT_CASE_IDS = new Set([
  "seed-thai-who-is-jesus",
  "seed-russian-who-is-jesus",
  "seed-arabic-who-is-jesus",
  "seed-french-hope-youth",
  "seed-lumo",
  "seed-falling-plates",
  "seed-prayer",
  "seed-new-believer",
  "seed-lonely-and-rejected",
  "seed-prodigal-son",
  "seed-walking-wth-jesus",
  "seed-world-cup",
  "seed-children",
  "seed-pentecost",
  "seed-birth-of-jesus",
  "seed-bible",
  "seed-reflection-of-hope",
  "seed-soccer",
  "seed-lazaro",
  "seed-water-into-wine",
  "seed-no-result-random-held-out",
])

function intentFor(prompt: SeedPromptCase): AbsoluteSearchIntent {
  const tags = new Set(prompt.tags)
  if (tags.has("misspelling")) return "typo-recovery"
  if (tags.has("confusing")) return "confusing-or-no-result"
  if (tags.has("product-title") || tags.has("core-title")) {
    return "product-title"
  }
  if (tags.has("felt-need") || tags.has("scene-like")) {
    return "semantic-intent"
  }
  return "metadata-topic"
}

export function absolutePublicWatchQuerySet(): AbsolutePublicWatchQueryCase[] {
  return seedPromptsForLocales(undefined, { callerTrack: "public-watch" }).map(
    (prompt) => ({
      ...prompt,
      split: HELD_OUT_CASE_IDS.has(prompt.id) ? "held-out" : "development",
      intent: intentFor(prompt),
      expectedNoResult: prompt.tags.includes("expected-no-result"),
      multilingual: prompt.tags.includes("multilingual"),
    }),
  )
}
