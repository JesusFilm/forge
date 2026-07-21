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
