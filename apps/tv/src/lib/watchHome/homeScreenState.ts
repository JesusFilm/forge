// Pure, React-free state selection for the home screen. Extracted (like
// series/seriesScreenState.ts) so the bug-prone branch order — loading vs
// error vs empty vs content — is unit-testable under jest-expo, which
// cannot load .tsx.

export type HomeScreenState = "loading" | "error" | "empty" | "content"

/**
 * Which of the four home screen states renders. Mirrors the series screen's
 * resolveScreenState rule: error ONLY when the fetch failed AND nothing is
 * renderable (R16) — a stale model beats an error screen, so refetch
 * failures fall through to content. A failed fetch that is already retrying
 * (`loading` again) shows the spinner, not a flash of "No content available".
 *
 * Branch order — exactly the screen's previous inline order:
 * - "loading": no model yet and a fetch is in flight (initial load, or a
 *   retry from the error state).
 * - "error": no model and the last fetch failed (and is not retrying).
 * - "empty": no model with nothing in flight and no error, or a model that
 *   resolved zero cards — a zero-card model lands here regardless of
 *   loading/error, because the model wins state selection once it exists.
 * - "content": a model with at least one card, regardless of loading/error.
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
