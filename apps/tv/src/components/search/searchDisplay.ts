// Display-text resolution for the search screen (s-meta line, result-card chip /
// kind labels). Pure module — no React/component imports — so jest-expo can
// unit-test it without loading the .tsx module graph.

import { type SearchState } from "../../lib/search"

/**
 * Uppercase meta line above the results (design: .s-meta). Only the ready state
 * with results speaks ("N RESULTS"); browse and transient states (idle/loading/
 * error/empty) stay quiet since their region below carries the message.
 */
export function resolveSearchMeta(
  state: SearchState,
  resultCount: number,
): string {
  switch (state) {
    case "idle":
      // Browse panel (empty query) or debounce-pending (mid-type) — both
      // unlabelled. The panel below is self-evident; no "BROWSE" eyebrow.
      return ""
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
 * Top-right thumb chip (design: .chip). childCount is the only usable quantity
 * (startSeconds is a match offset, not a duration), so it's the episode count or nothing.
 */
export function resultChipLabel(result: ChipSource): string | null {
  const count = result.childCount ?? 0
  if (count <= 0) return null
  return `${count} EP`
}

type KindSource = {
  type: string
  label?: string | null
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
 * Secondary "kind" line under the result title (design: .card-meta p). Uses the
 * wire label when present. An unlabeled result reads "Video" however many children
 * it has, because that is where searchResultPath now sends it — children alone no
 * longer imply a series.
 */
export function resultKindLabel(result: KindSource): string {
  if (result.type === "EXPERIENCE") return "Experience"
  if (result.label != null && result.label.length > 0) {
    return humanizeLabel(result.label)
  }
  return "Video"
}
