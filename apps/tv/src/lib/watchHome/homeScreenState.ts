// Pure, React-free home-screen state selection. Extracted (like
// series/seriesScreenState.ts) so the bug-prone branch order (loading/error/
// empty/content) is unit-testable under jest-expo, which cannot load .tsx.

export type HomeScreenState = "loading" | "error" | "empty" | "content"

/**
 * Which of the four states renders. Mirrors series resolveScreenState (R16):
 * error ONLY when fetch failed AND nothing renderable, so a stale model beats
 * error and a retrying fetch shows the spinner, not "No content available".
 * Branch order: a model wins once it exists (>=1 card -> content, 0 -> empty);
 * with no model, loading (fetch in flight) beats error (failed, not retrying)
 * beats empty (idle).
 */
export function resolveHomeScreenState(input: {
  model: {
    featured: readonly unknown[]
    sections: readonly unknown[]
  } | null
  loading: boolean
  error: string | null
}): HomeScreenState {
  if (input.model == null && input.loading) return "loading"
  if (input.model == null && input.error != null) return "error"
  if (
    input.model == null ||
    (input.model.featured.length === 0 && input.model.sections.length === 0)
  ) {
    return "empty"
  }
  return "content"
}
