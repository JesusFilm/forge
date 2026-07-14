import { resolveDefaultSlug } from "./resolveDefaultLanguage"

/**
 * Pure choreography around {@link resolveDefaultSlug}, shared by the twin session
 * providers (Watch per-video, Series). Owns the user-intent guard, the once-per-
 * identity gate, and preferences-ready gating — everything but React state itself.
 */

// The language options resolveDefaultSlug ranks. Derived from its signature so
// the reconciler tracks the primitive's shape without re-declaring (or exporting) it.
type LanguageOptions = Parameters<typeof resolveDefaultSlug>[0]

/**
 * Guard state one provider concern (audio / subtitle / series language) tracks.
 * `resolvedFor` is the item identity a default was last resolved for (keyed on
 * the Language slug's owner — documentId, never bcp47); `userChose` is explicit intent.
 */
export type ReconcilerState = {
  resolvedFor: string | null
  userChose: boolean
}

export const INITIAL_RECONCILER_STATE: ReconcilerState = {
  resolvedFor: null,
  userChose: false,
}

export type ReconcileInput = {
  /** Preferences store hydrated — gate so the persisted choice applies first. */
  ready: boolean
  /** Item identity (video/variant/series documentId); resolve once per value. */
  identity: string | null
  options: LanguageOptions
  primaryBcp47: string | null
  /** The persisted preference slug matched exactly by resolveDefaultSlug. */
  preferredSlug: string | null
}

export type ReconcileResult = {
  nextState: ReconcilerState
  /**
   * Present only when resolution ran (all guards passed). `slug` is
   * resolveDefaultSlug's raw result — may be null; the caller maps it to its own
   * apply (variant index / selected slug), preserving each provider's fallback.
   */
  apply?: { slug: string | null }
}

/**
 * Flip the guard on an explicit user pick so later re-resolution can't override
 * it. Persisting + setting state stays with the provider — only the guard lives here.
 */
export function markUserChoice(state: ReconcilerState): ReconcilerState {
  return { ...state, userChose: true }
}

/** New item identity clears both guards so its default re-resolves cleanly. */
export function resetReconciler(): ReconcilerState {
  return { ...INITIAL_RECONCILER_STATE }
}

/**
 * Decide whether to apply a resolved default. Guard order mirrors the providers'
 * original effects exactly: not-ready → no options → user chose → already resolved
 * for this identity. When it runs, `resolvedFor` advances even if the slug is null.
 */
export function reconcileDefault(
  state: ReconcilerState,
  input: ReconcileInput,
): ReconcileResult {
  if (!input.ready) return { nextState: state }
  if (input.options.length === 0) return { nextState: state }
  if (state.userChose) return { nextState: state }
  if (state.resolvedFor === input.identity) return { nextState: state }

  const nextState = { ...state, resolvedFor: input.identity }
  const slug = resolveDefaultSlug(
    input.options,
    input.primaryBcp47,
    input.preferredSlug,
  )
  return { nextState, apply: { slug } }
}
