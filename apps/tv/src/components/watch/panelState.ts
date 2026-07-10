// Pure, React-free UI-state logic for the Language/Subtitle panels. Extracted
// so the media-state → UI-state mapping and disabled-row annotation are testable
// without rendering: jest-expo can't load `.tsx` (csstype import trips it).

import type { DubMediaState } from "../../contexts/watchSessionState"
import type { WatchSubtitle, WatchVariant } from "../../lib/normalizeVideo"
import { validateStreamingUrl } from "../../lib/validateUrl"

// ── Subtitle panel: media-state → discriminated UI state ───────────────────

/**
 * The mutually-exclusive shapes the Subtitle panel renders. `loaded` carries
 * rows (may be empty → "No subtitles available"); loading/error are non-focusable
 * status rows. Close stays focusable in every case, so dismiss is never gated.
 */
export type SubtitlePanelState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "loaded"; subtitles: WatchSubtitle[] }

/**
 * Map the active-dub media flags to the Subtitle panel's UI state. Precedence:
 * loading → error → loaded. `media == null` is "not yet loaded" → render loading
 * so the panel never flashes empty before the lazy fetch resolves.
 */
export function deriveSubtitlePanelState(
  state: DubMediaState,
): SubtitlePanelState {
  if (state.loading) return { kind: "loading" }
  if (state.error) return { kind: "error" }
  if (state.media == null) return { kind: "loading" }
  // Alphabetical by display name (A→Z) so the track list is scannable; the
  // panel's always-on "Subtitles off" row is prepended in the component, not
  // here, so it stays pinned to the top regardless of this ordering.
  const subtitles = [...state.media.subtitles].sort((left, right) =>
    subtitleDisplayName(left).localeCompare(subtitleDisplayName(right)),
  )
  return { kind: "loaded", subtitles }
}

/** Display name a subtitle row renders — the same precedence the panel uses. */
function subtitleDisplayName(subtitle: WatchSubtitle): string {
  return subtitle.languageName || subtitle.languageSlug || ""
}

/**
 * Whether a subtitle row is the active selection. Slug-keyed (bcp47 is not
 * unique across JFP languages). Active only when enabled AND the slug matches,
 * so the "Off" choice never marks a track row active.
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
 * A variant annotated for the Language panel. A dub with no playable stream is
 * `disabled` — muted and not focusable-as-selectable so the viewer can't pick an
 * unplayable language. `active` marks the selected dub for the checkmark.
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
 * Playable when the HLS URL passes `validateStreamingUrl` (Mux-hosted HLS).
 * Non-empty isn't enough: normalizeVideo passes raw CMS `hls`, so a dub can carry
 * a non-Mux URL the player rejects at Play time. Same guard → disabled, not inert.
 */
export function isVariantPlayable(variant: Pick<WatchVariant, "hls">): boolean {
  return validateStreamingUrl(variant.hls)
}

/**
 * Annotate variants for the Language panel: mark unplayable dubs disabled, the
 * active index active, and preserve the original index so a selection writes back
 * the correct `activeVariantIndex`.
 */
export function annotateVariantRows(
  variants: readonly WatchVariant[],
  activeVariantIndex: number,
): AnnotatedVariantRow[] {
  // Sort A→Z by display name AFTER annotating, so each row keeps its original
  // `index` for write-back (`setActiveVariantIndex`) even though display order
  // changes. A stable sort keeps same-named dubs in their source order.
  return variants
    .map((variant, index) => ({
      variant,
      index,
      disabled: !isVariantPlayable(variant),
      active: index === activeVariantIndex,
    }))
    .sort((left, right) =>
      variantDisplayName(left.variant).localeCompare(
        variantDisplayName(right.variant),
      ),
    )
}

/** Display name a variant row renders — the same precedence the panels use. */
function variantDisplayName(variant: WatchVariant): string {
  return variant.languageName ?? variant.languageSlug ?? variant.slug ?? ""
}
