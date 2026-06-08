// Pure, React-free UI-state logic for the on-page Language / Subtitle panels.
// Extracted so the bug-prone media-state → UI-state mapping and the
// disabled-row annotation are unit-testable without rendering: jest-expo can't
// load `.tsx` (the @types/react csstype import trips the transform), so the
// testable logic lives here and the panels are thin React shells over it.

import type { DubMediaState } from "../../contexts/watchSessionState"
import type { WatchSubtitle, WatchVariant } from "../../lib/normalizeVideo"
import { validateStreamingUrl } from "../../lib/validateUrl"

// ── Subtitle panel: media-state → discriminated UI state ───────────────────

/**
 * The four mutually-exclusive shapes the Subtitle panel renders after
 * `ensureActiveVariantMedia()` runs. The `loaded` case carries the subtitle
 * rows (which may be empty — the panel shows a "No subtitles available" row for
 * `subtitles.length === 0`). Loading / error are surfaced as non-focusable
 * status rows; in every case the panel's Close affordance stays focusable, so
 * the discriminant never gates the dismiss path.
 */
export type SubtitlePanelState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "loaded"; subtitles: WatchSubtitle[] }

/**
 * Map the session's active-dub media flags to the Subtitle panel's UI state.
 *
 * Precedence mirrors the provider's own semantics:
 *   1. `loading` while the dub's media request is in flight,
 *   2. `error` when the fetch failed (vs. loaded-but-empty),
 *   3. `loaded` once media is non-null — `media == null` is still "not yet
 *      loaded", which we render as `loading` so the panel never flashes an
 *      empty list before the lazy fetch resolves.
 *
 * A `loaded` state with `subtitles: []` is the loaded-empty case and is
 * distinct from `loading`/`error`; the panel renders a "No subtitles
 * available" row for it.
 */
export function deriveSubtitlePanelState(
  state: DubMediaState,
): SubtitlePanelState {
  if (state.loading) return { kind: "loading" }
  if (state.error) return { kind: "error" }
  if (state.media == null) return { kind: "loading" }
  return { kind: "loaded", subtitles: state.media.subtitles }
}

/**
 * Whether a subtitle row is the active selection. Slug-keyed (the subtitle slug
 * IS the unique language slug — bcp47 is not unique across JFP languages). Only
 * active when subtitles are enabled AND the slug matches, so the "Off" choice
 * (`subtitleEnabled === false`) never marks a track row active.
 */
export function isSubtitleRowActive(
  subtitle: Pick<WatchSubtitle, "languageSlug">,
  subtitleEnabled: boolean,
  activeSubtitleSlug: string | null,
): boolean {
  return subtitleEnabled && activeSubtitleSlug === subtitle.languageSlug
}

// ── Language panel: variant-row annotation ─────────────────────────────────

/**
 * A variant annotated for rendering in the Language panel. A published dub with
 * no playable stream (`hls == null` / empty) is `disabled` — rendered visually
 * muted and NOT focusable-as-selectable so the viewer can't pick an unplayable
 * language. `active` marks the currently-selected dub for the checkmark.
 */
export type AnnotatedVariantRow = {
  variant: WatchVariant
  /** Original index into the session's `variants`, for `setActiveVariantIndex`. */
  index: number
  /** No playable HLS stream → inert, non-selectable row. */
  disabled: boolean
  /** Currently-selected dub → checkmark. */
  active: boolean
}

/**
 * A variant is playable when its HLS URL is one the player will actually accept
 * — i.e. it passes `validateStreamingUrl` (Mux-hosted HLS). Gating on non-empty
 * alone is not enough: `normalizeVideo` passes the raw CMS `hls` through, so a
 * published dub can carry a non-Mux URL that the player's own
 * `validateStreamingUrl` guard rejects at Play time. Keeping this gate in sync
 * with that guard means a dub the player can't play renders as a disabled row
 * instead of a selectable one that silently does nothing.
 */
export function isVariantPlayable(variant: Pick<WatchVariant, "hls">): boolean {
  return validateStreamingUrl(variant.hls)
}

/**
 * Annotate the session's variants for the Language panel: mark unplayable dubs
 * (`hls == null` / empty) disabled, the active index active, and preserve the
 * original index so a selection writes back the correct `activeVariantIndex`.
 */
export function annotateVariantRows(
  variants: readonly WatchVariant[],
  activeVariantIndex: number,
): AnnotatedVariantRow[] {
  return variants.map((variant, index) => ({
    variant,
    index,
    disabled: !isVariantPlayable(variant),
    active: index === activeVariantIndex,
  }))
}
