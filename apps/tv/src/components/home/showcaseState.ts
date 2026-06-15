// Pure state for the Home screen's Focus-Driven Showcase (R10/R11). Kept as a
// React-free .ts module (like searchResultPath.ts / seriesScreenState.ts) so
// it is unit-testable under jest-expo, which cannot load .tsx.
//
// The reducer is synchronous and pure; the ~150ms trailing debounce on focus
// commits lives component-side via createShowcaseFocusDebouncer (patterns doc
// tv-focus-driven-hero-patterns-20260420.md §4 — committing on every
// micro-focus event thrashes during fast D-pad traversal).

import type { WatchHomeCard, WatchHomeModel } from "../../lib/watchHome/model"

export type ShowcaseState = {
  current: WatchHomeCard | null
}

export type ShowcaseEvent =
  /** First model arrived — seed the showcase with the initial card. */
  | { type: "modelResolved"; model: WatchHomeModel }
  /** A rail card gained focus (already debounced by the component). */
  | { type: "cardFocused"; card: WatchHomeCard }
  /** Focus moved to a non-card element (search chip, retry) — retain (AE4). */
  | { type: "nonCardFocused" }
  /** A background refetch delivered a new model. */
  | { type: "modelRefreshed"; model: WatchHomeModel }

export const INITIAL_SHOWCASE_STATE: ShowcaseState = { current: null }

/** Trailing-debounce window for focus-driven showcase commits. */
export const SHOWCASE_FOCUS_DEBOUNCE_MS = 150

/**
 * Initial showcase pick (R10/AE7): the first featured card, falling back to
 * the first card of the first non-empty section, else null (the screen falls
 * to its empty state). The model already drops empty sections; the length
 * check is defensive.
 */
export function initialShowcaseCard(
  model: WatchHomeModel,
): WatchHomeCard | null {
  if (model.featured.length > 0) return model.featured[0]
  const section = model.sections.find((s) => s.cards.length > 0)
  return section?.cards[0] ?? null
}

function findCardById(model: WatchHomeModel, id: string): WatchHomeCard | null {
  const featured = model.featured.find((card) => card.id === id)
  if (featured) return featured
  for (const section of model.sections) {
    const card = section.cards.find((c) => c.id === id)
    if (card) return card
  }
  return null
}

export function showcaseReducer(
  state: ShowcaseState,
  event: ShowcaseEvent,
): ShowcaseState {
  switch (event.type) {
    case "modelResolved":
      return { current: initialShowcaseCard(event.model) }
    case "cardFocused":
      // Same card object re-committed (debounce settling on the card already
      // shown) — return the same reference so useReducer bails out.
      return state.current === event.card ? state : { current: event.card }
    case "nonCardFocused":
      // Retain the last card. Same-reference return — no re-render.
      return state
    case "modelRefreshed": {
      if (state.current == null) {
        return { current: initialShowcaseCard(event.model) }
      }
      // Keep the current pick when its id survives the refresh — adopting the
      // refreshed instance so the canvas reflects updated data — else
      // re-derive the initial card from the new model.
      const match = findCardById(event.model, state.current.id)
      return { current: match ?? initialShowcaseCard(event.model) }
    }
  }
}

export type ShowcaseFocusDebouncer = {
  focus: (card: WatchHomeCard) => void
  /** Clears any pending commit — call on unmount. */
  cancel: () => void
}

/**
 * Trailing-only debounce: rapid focus A→B→C commits once, with C, after the
 * window closes. The component holds one instance in a ref and wires `focus`
 * into every card's onFocus.
 */
export function createShowcaseFocusDebouncer(
  commit: (card: WatchHomeCard) => void,
  delayMs: number = SHOWCASE_FOCUS_DEBOUNCE_MS,
): ShowcaseFocusDebouncer {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    focus(card) {
      if (timer != null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        commit(card)
      }, delayMs)
    },
    cancel() {
      if (timer != null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
