// Display-text resolution for the redesigned search screen — the s-meta
// line and the result-card chip / kind labels. Pure module (no React, no
// component imports) so jest-expo can unit-test it without loading the
// .tsx module graph. The SearchState import is type-only and erased at
// compile time.

import { isSeriesSearchResult } from "../../lib/isSeriesRecord"
import { type SearchState } from "../../lib/search"

/**
 * The uppercase meta line between the letter strip and the results region
 * (design: .s-meta). Empty query browses ("BROWSE" — the design says
 * "Browse all"; ours introduces the browse panel), results show a count,
 * and transient states (loading / error / empty) stay quiet — their region
 * below carries the message.
 *
 * `hasQuery` distinguishes the genuinely-empty browse state from the brief
 * idle window AFTER the first keystroke (debounce pending, no results yet):
 * showing "BROWSE" over a non-empty query flashed the browse label across
 * the results region. Idle + non-empty stays quiet until the search fires.
 */
export function resolveSearchMeta(
  state: SearchState,
  resultCount: number,
  hasQuery: boolean,
): string {
  switch (state) {
    case "idle":
      // Empty query → the browse panel is showing below, so label it.
      // Non-empty query → debounce is pending; stay quiet (no BROWSE flash).
      return hasQuery ? "" : "BROWSE"
    case "ready":
      if (resultCount === 0) return ""
      return resultCount === 1 ? "1 RESULT" : `${resultCount} RESULTS`
    case "loading":
    case "empty":
    case "error":
      return ""
    default: {
      // Compile-time exhaustiveness — a future SearchState variant
      // forces tsc to error here until the matching branch is added.
      const _exhaustive: never = state
      return _exhaustive
    }
  }
}

type ChipSource = {
  childCount?: number | null
}

/**
 * Top-right thumb chip (design: .chip). The only quantity a SearchResult
 * carries today is childCount — startSeconds is a match offset, not a
 * duration — so the chip is the episode count or nothing.
 */
export function resultChipLabel(result: ChipSource): string | null {
  const count = result.childCount ?? 0
  if (count <= 0) return null
  return `${count} EP`
}

type KindSource = {
  type: string
  label?: string | null
  childCount?: number | null
}

/** "FEATURE_FILM" → "Feature Film". */
function humanizeLabel(label: string): string {
  return label
    .split("_")
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ")
}

/**
 * Secondary line under the result title (design: .card-meta p — the
 * "kind" line). Derived from the wire label when present; series-shaped
 * unlabeled results (childCount > 0) read as "Series" so the kind line
 * agrees with where searchResultPath routes them.
 */
export function resultKindLabel(result: KindSource): string {
  if (result.type === "EXPERIENCE") return "Experience"
  if (result.label != null && result.label.length > 0) {
    return humanizeLabel(result.label)
  }
  if (isSeriesSearchResult(result)) return "Series"
  return "Video"
}
