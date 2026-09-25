/**
 * The timing track (KTD5): which subtitle track of the playing dub's Video
 * Edition gives a clip its sentence timing, and whether that track is usable.
 */

import type { VttCue } from "../parseVtt"
import { buildEligibleStarts } from "./clipWindow"
import {
  deriveClipTiming,
  MAX_TIMING_CUES,
  type ClipTiming,
} from "./sentenceTiming"

/** Fewer sentence-ending cues than this share, and the track fails. */
export const MIN_SENTENCE_END_SHARE = 0.2

/** A last cue this far past the dub's length means drift or another cut. */
export const MAX_CUE_OVERRUN_SECONDS = 5

/** The subtitle fields the choice reads, as `WatchDubMedia` selects them. */
export type TimingSubtitle = {
  vttSrc?: string | null
  primary?: boolean | null
  aiGenerated?: boolean | null
  language?: { slug?: string | null } | null
}

export type TimingTrackTier = "feedLanguage" | "primary" | "humanMade" | "any"

export type TimingTrackCandidate<T extends TimingSubtitle> = {
  tier: TimingTrackTier
  vttSrc: string
  track: T
}

export type TimingTrackFailure =
  | "no_cues"
  | "too_many_cues"
  | "unknown_duration"
  | "past_duration"
  | "few_sentence_ends"
  | "no_windows"

export type TimingTrackVerdict =
  | { ok: true; timing: ClipTiming }
  | { ok: false; reason: TimingTrackFailure }

/**
 * The tracks to try, in KTD5 order, at most one per tier, human-made first
 * within a tier. It reads only the playing dub's edition, never another one.
 */
export function timingTrackOrder<T extends TimingSubtitle>(
  playingDub:
    | { videoEdition?: { subtitles?: readonly T[] | null } | null }
    | null
    | undefined,
  feedLanguageSlug: string,
): TimingTrackCandidate<T>[] {
  const usable = (playingDub?.videoEdition?.subtitles ?? []).filter(
    (t): t is T & { vttSrc: string } =>
      typeof t.vttSrc === "string" && t.vttSrc.length > 0,
  )
  const chosen = new Set<string>()
  const order: TimingTrackCandidate<T>[] = []

  const take = (tier: TimingTrackTier, fits: (t: T) => boolean) => {
    const open = usable.filter((t) => fits(t) && !chosen.has(t.vttSrc))
    const track = open.find((t) => t.aiGenerated === false) ?? open[0]
    if (track == null) return
    chosen.add(track.vttSrc)
    order.push({ tier, vttSrc: track.vttSrc, track })
  }

  take("feedLanguage", (t) => t.language?.slug === feedLanguageSlug)
  take("primary", (t) => t.primary === true)
  take("humanMade", (t) => t.aiGenerated === false)
  take("any", () => true)
  return order
}

function fail(reason: TimingTrackFailure): TimingTrackVerdict {
  return { ok: false, reason }
}

/**
 * KTD5's checks on parsed cues. A track that passes them but gives no clip
 * window also fails, so "no window" later means only that the record is full.
 */
export function checkTimingTrack(
  cues: readonly VttCue[],
  dubDurationSeconds: number,
): TimingTrackVerdict {
  if (cues.length === 0) return fail("no_cues")
  if (cues.length > MAX_TIMING_CUES) return fail("too_many_cues")
  if (!Number.isFinite(dubDurationSeconds) || dubDurationSeconds <= 0) {
    return fail("unknown_duration")
  }
  const timing = deriveClipTiming(cues)
  if (timing == null) return fail("too_many_cues")
  if (timing.lastCueEnd > dubDurationSeconds + MAX_CUE_OVERRUN_SECONDS) {
    return fail("past_duration")
  }
  if (timing.sentenceEndCount < timing.cueCount * MIN_SENTENCE_END_SHARE) {
    return fail("few_sentence_ends")
  }
  if (buildEligibleStarts(timing, []).length === 0) return fail("no_windows")
  return { ok: true, timing }
}
