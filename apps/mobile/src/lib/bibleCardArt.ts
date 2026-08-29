/**
 * Which artwork each Bible quote card may draw, best tier first. An ordered
 * LIST per card, not one URL: a single value leaves a card that fails to load
 * nothing to fall to. See the plan for the tiers and their reasons.
 */

import {
  extractMuxPlaybackId,
  isMuxPlaybackId,
  muxThumbnailAtSecond,
} from "./muxThumbnail"
import type { WatchBibleCitation, WatchVariant } from "./normalizeVideo"
import { resolveImageUrl } from "./resolveImageUrl"

/** The best tier the video resolved. `unsettled` means the payload is still filling in. */
export type BibleCardArtTier =
  | "still"
  | "authored"
  | "stock"
  | "none"
  | "unsettled"

export type BibleCardArtInput = {
  /** The video's dubs. The pinned one is chosen here, never the active one. */
  variants: readonly WatchVariant[]
  /** The video's own resolved card art, already picked from its image set. */
  authoredImageUrl: string | null
  citations: readonly WatchBibleCitation[]
  /** The last rung of the ladder, owned by the caller so this module stays data-free. */
  stockImages: readonly string[]
  /**
   * False while the watch query is filling in from partial cached data. A
   * partial payload and a still-less video arrive as the SAME shape, so this
   * is the only input that can tell them apart.
   */
  payloadSettled: boolean
}

export type BibleCardArt = {
  /** One ordered candidate list per citation, aligned to the input array. */
  candidates: string[][]
  tier: BibleCardArtTier
  /** True when some dub resolves a playback id, whatever tier won. */
  hasPlaybackId: boolean
}

/**
 * The middle 80% of the film. The opening and closing tenths carry titles,
 * logos, and credits.
 */
export const STILL_WINDOW_START = 0.1
export const STILL_WINDOW_END = 0.9

// A still at second 0 comes back as an all-black frame, so no computed
// timestamp may round down to it however short the runtime is.
const MIN_STILL_SECOND = 0.01

/**
 * A USABLE id, never merely a non-null one. A malformed stored value must not
 * short-circuit the stream-URL fallback, which can still recover a clean id —
 * and must not let a caller claim a still it cannot build.
 */
function playbackIdOf(variant: WatchVariant): string | null {
  if (isMuxPlaybackId(variant.muxPlaybackId)) return variant.muxPlaybackId
  return extractMuxPlaybackId(variant.hls)
}

/** Whether admin supplied an id at all — the monitor's denominator, so a
 *  malformed one still counts as "this video should have served a still". */
function suppliesPlaybackId(variant: WatchVariant): boolean {
  return variant.muxPlaybackId != null || variant.hls != null
}

function hasUsableRuntime(duration: number | null): duration is number {
  return duration != null && Number.isFinite(duration) && duration > 0
}

/**
 * Admin's dub relation has no ORDER BY, so sorting by documentId is what keeps
 * a card's still identical on every view. Preferring a dub that also resolves
 * a runtime stops an unlucky pick demoting a video a sibling dub could serve.
 */
function pinDub(variants: readonly WatchVariant[]): WatchVariant | null {
  const published = [...variants]
    .filter((v) => v.published)
    .sort((a, b) => a.documentId.localeCompare(b.documentId))

  const qualified = published.find(
    (v) => playbackIdOf(v) != null && hasUsableRuntime(v.duration),
  )
  return qualified ?? published.find((v) => playbackIdOf(v) != null) ?? null
}

/**
 * Even spacing across the window. Pure in `(runtime, index, count)`, which is
 * what makes a still identical on every device without per-video data. The
 * half-step offset puts a lone citation at the exact middle of the film.
 */
function stillSecond(runtime: number, index: number, count: number): number {
  const span = STILL_WINDOW_END - STILL_WINDOW_START
  const fraction = STILL_WINDOW_START + (span * (index + 0.5)) / count
  // NOT `clamp`: on a sub-second runtime the window's top falls below
  // MIN_STILL_SECOND, and a clamp would return the floor — a timestamp past
  // the end of the film. Nested this way the window cap always wins.
  return Math.min(
    Math.max(runtime * fraction, MIN_STILL_SECOND),
    runtime * STILL_WINDOW_END,
  )
}

/**
 * Admin collapses a null `order` to zero, so two citations can swap between
 * requests. The documentId tie-break pins each to the position that picks its
 * timestamp.
 */
function orderedPositions(
  citations: readonly WatchBibleCitation[],
): Map<number, number> {
  const positions = new Map<number, number>()
  citations
    .map((citation, inputIndex) => ({ citation, inputIndex }))
    .sort((a, b) => {
      const byOrder = (a.citation.order ?? 0) - (b.citation.order ?? 0)
      if (byOrder !== 0) return byOrder
      return a.citation.documentId.localeCompare(b.citation.documentId)
    })
    .forEach(({ inputIndex }, position) => positions.set(inputIndex, position))
  return positions
}

/** The best rung any card reached — the value the caller logs per video. */
function resolvedTier(
  canServeStill: boolean,
  hasAuthored: boolean,
  hasStock: boolean,
): BibleCardArtTier {
  if (canServeStill) return "still"
  if (hasAuthored) return "authored"
  if (hasStock) return "stock"
  return "none"
}

export function deriveBibleCardArt(input: BibleCardArtInput): BibleCardArt {
  const { citations, stockImages, authoredImageUrl, payloadSettled } = input

  const pinned = pinDub(input.variants)
  const playbackId = pinned == null ? null : playbackIdOf(pinned)
  const runtime = pinned?.duration ?? null
  const canServeStill = playbackId != null && hasUsableRuntime(runtime)
  // Deliberately NOT `playbackId != null`: a video whose stored id is
  // malformed still belongs in the monitor's denominator, or the one alert for
  // a mass validation failure goes blind exactly when it fires.
  const hasPlaybackId = input.variants.some(
    (v) => v.published && suppliesPlaybackId(v),
  )

  if (citations.length === 0) {
    return {
      candidates: [],
      tier: canServeStill ? "still" : "none",
      hasPlaybackId,
    }
  }

  // Absent fields plus an unsettled payload is indistinguishable from a
  // genuinely still-less video, so hold at the card's background colour rather
  // than paint a lower tier that the full payload would flip.
  if (!canServeStill && !payloadSettled) {
    return {
      candidates: citations.map(() => []),
      tier: "unsettled",
      hasPlaybackId,
    }
  }

  // The sole validator for everything this module emits (the render site keeps
  // its own call for the Experience and SDUI values, which never come through
  // here). Rejected tiers are omitted, never left as holes.
  const positions = orderedPositions(citations)
  const authored = resolveImageUrl(authoredImageUrl)

  const candidates = citations.map((_citation, inputIndex) => {
    const position = positions.get(inputIndex) ?? inputIndex
    const list: string[] = []

    if (canServeStill) {
      const still = muxThumbnailAtSecond(
        playbackId,
        stillSecond(runtime, position, citations.length),
      )
      if (still != null) list.push(still)
    }
    if (authored != null) list.push(authored)

    const stock =
      stockImages.length > 0
        ? resolveImageUrl(stockImages[position % stockImages.length])
        : null
    if (stock != null) list.push(stock)

    return list
  })

  const topTier = resolvedTier(
    canServeStill,
    authored != null,
    candidates.some((list) => list.length > 0),
  )

  return { candidates, tier: topTier, hasPlaybackId }
}
