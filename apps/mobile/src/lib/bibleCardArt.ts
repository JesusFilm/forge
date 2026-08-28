/**
 * Which artwork each Bible quote card on a video may draw, best tier first.
 *
 * A pure derivation from the video's dubs, its authored image, and its
 * citations. The card used to take one of seven stock photographs by index, so
 * a viewer finishing Pilgrim's Progress read a Hebrews citation over a candle
 * that would sit equally well on any other film. Here the artwork comes from
 * the film itself.
 *
 * It returns an ordered LIST per card rather than one resolved URL. A single
 * value leaves the card nothing to advance to when a still fails to load, and
 * the card would sit at its background colour with no way down the ladder.
 */

import { extractMuxPlaybackId, muxThumbnailAtSecond } from "./muxThumbnail"
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
   * False while the watch query is still filling in from partial cached data.
   * An incomplete payload and a genuinely still-less video arrive as the SAME
   * shape — a dub with a null runtime and a null playback id — so this is the
   * only input that can tell them apart.
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
 * Stills come from the middle 80% of the film. The opening and closing tenths
 * carry titles, logos, and credits — the frames least likely to say anything
 * about the story.
 */
export const STILL_WINDOW_START = 0.1
export const STILL_WINDOW_END = 0.9

// A still at second 0 comes back as an all-black frame, so no computed
// timestamp may round down to it however short the runtime is.
const MIN_STILL_SECOND = 0.01

function playbackIdOf(variant: WatchVariant): string | null {
  return variant.muxPlaybackId ?? extractMuxPlaybackId(variant.hls)
}

function hasUsableRuntime(duration: number | null): duration is number {
  return duration != null && Number.isFinite(duration) && duration > 0
}

/**
 * Admin's dub relation has no ORDER BY, so the array can reorder between
 * requests. Sorting by documentId first is what keeps a card's still identical
 * on every view; without it every still on the video can move.
 *
 * The pin also carries the still tier's own preconditions. Taking merely the
 * first playable dub would demote a whole video whose sibling dub could serve
 * it, and the monitoring signal would read that as a defect.
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
 * Even spacing across the window, indexed by the citation's position. Pure in
 * `(runtime, index, count)`, which is what makes a card's still identical on
 * every device and across launches without any per-video data.
 *
 * The half-step offset puts a lone citation at the exact middle of the film and
 * keeps every timestamp strictly inside the window.
 */
function stillSecond(runtime: number, index: number, count: number): number {
  const span = STILL_WINDOW_END - STILL_WINDOW_START
  const fraction = STILL_WINDOW_START + (span * (index + 0.5)) / count
  return Math.min(
    Math.max(runtime * fraction, MIN_STILL_SECOND),
    runtime * STILL_WINDOW_END,
  )
}

/**
 * Citations sort on `order` with nulls collapsing to zero, so two of them can
 * swap between requests. The documentId tie-break pins each one to a position,
 * and the position is what picks its timestamp.
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

export function deriveBibleCardArt(input: BibleCardArtInput): BibleCardArt {
  const { citations, stockImages, authoredImageUrl, payloadSettled } = input

  const pinned = pinDub(input.variants)
  const playbackId = pinned == null ? null : playbackIdOf(pinned)
  const runtime = pinned?.duration ?? null
  const canServeStill = playbackId != null && hasUsableRuntime(runtime)

  if (citations.length === 0) {
    return {
      candidates: [],
      tier: canServeStill ? "still" : "none",
      hasPlaybackId: playbackId != null,
    }
  }

  // Absent fields plus an unsettled payload is indistinguishable from a
  // genuinely still-less video, so hold at the card's background colour rather
  // than paint a lower tier that the full payload would flip.
  if (!canServeStill && !payloadSettled) {
    return {
      candidates: citations.map(() => []),
      tier: "unsettled",
      hasPlaybackId: playbackId != null,
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

  const topTier: BibleCardArtTier = canServeStill
    ? "still"
    : authored != null
      ? "authored"
      : candidates.some((list) => list.length > 0)
        ? "stock"
        : "none"

  return { candidates, tier: topTier, hasPlaybackId: playbackId != null }
}
