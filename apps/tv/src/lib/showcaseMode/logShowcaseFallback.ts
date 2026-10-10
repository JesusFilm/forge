import { datadogLog } from "../datadog"
import type { ShowcaseFallbackReason } from "./sourceResolution"
import type { ShowcaseParseDrops } from "./types"

/**
 * Every reel degrade is observable, mirroring logWatchHomeFallback: the reason is a
 * FIRST-CLASS context attribute (facetable), never interpolated into the message.
 * Without it "no Experience", "fetch errored" and "parsed empty" are one bucket.
 */
export function logShowcaseFallback(args: {
  reason: ShowcaseFallbackReason
}): void {
  datadogLog.warn("showcase_fallback", { reason: args.reason })
}

/**
 * KTD-9: a language chapter's sentence-aware hop plan degraded to the fixed grid. The
 * closed reason union rides as a first-class facetable field — counts and enums only,
 * never subtitle text (the action-name privacy rule). The sentence-aware happy path is
 * silent; only a degrade logs.
 */
export type SentencePlanFallbackReason =
  | "no-subtitle"
  | "fetch-failed"
  | "parse-empty"
  | "no-usable-boundaries"
  | "timeout"

export function logSentencePlanFallback(args: {
  reason: SentencePlanFallbackReason
}): void {
  datadogLog.warn("showcase_sentence_plan_fallback", { reason: args.reason })
}

/**
 * A curator's only feedback loop: their authoring surface is a free-text title and a
 * coreId, and a mistake in either drops silently. Counts, never CMS strings — the
 * action-name privacy rule applies to log context too.
 */
export function logShowcaseParseDrops(drops: ShowcaseParseDrops): void {
  if (drops.items === 0 && drops.chapters === 0) return
  datadogLog.warn("showcase_experience_drops", {
    dropped_items: drops.items,
    dropped_chapters: drops.chapters,
  })
}
