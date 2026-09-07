/**
 * Test-only guard for display utilities that override line-clamp's display.
 * Browser-caught in feat-269; jsdom cannot observe the resulting unclamp.
 */
export const displayUtilities = [
  "block",
  "inline-block",
  "inline",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "table",
  "inline-table",
  "flow-root",
  "contents",
  "list-item",
  "hidden",
] as const
