/**
 * KTD-5: turn the Language Centerpiece's dub list into the ordered hop plan the player
 * (U6) executes. One dub-rich video switches audio mid-play — English first (R8), then
 * randomly-ordered unique dubs, ~10s each, 6-9 languages inside a ~60-90s window (R9).
 *
 * The ~60-90s span is the deliberate exception to R6's 20-40s excerpt band: every hop is
 * the SAME footage in a different dub, advancing one continuous media position, so the
 * plan reads as one scene whose language keeps changing.
 *
 * Pure and deterministic: the caller injects `rng` (0<=x<1); this module never calls
 * Math.random or Date.now. Returns null when the centerpiece can't showcase a switch —
 * fewer than two playable languages, or a source too short / duration unknown — and the
 * caller falls back to ordinary excerpt behaviour (resolveExcerptStream).
 */

import { resolveDefaultSlug } from "../resolveDefaultLanguage"
import {
  playableDubs,
  toDefaultSlugOptions,
  type ShowcaseDubInput,
} from "./languageRotation"
import type { SentenceTiming } from "./sentenceTiming"
import { CREDITS_TAIL_SECONDS } from "./sourceResolution"
import type { ExcerptWindow, ShowcaseStream } from "./types"

/** English's unique language slug — exact identity, never a bcp47 prefix (en-nai collides). */
const ENGLISH_SLUG = "english"

/** One segment holds a single dub before the audio switches (R8: "~10s per segment"). */
export const HOP_SEGMENT_SECONDS = 10

/** R8/R9 ceiling: at most 9 languages, so at most 9x10 = 90s total. */
export const MAX_HOPS = 9

/**
 * R3 pathology guard: a sentence-aware segment stretches past 10s to finish its
 * sentence (15-20s is normal), but a track with no qualifying pause would otherwise run
 * unbounded — so a segment is ceiling-cut at the nearest cue edge by this length.
 */
export const MAX_HOP_SEGMENT_SECONDS = 30

/**
 * KTD-6 sentinel: the reference track produced no usable sentence-aligned plan (its very
 * first segment would already ceiling-cut). The caller logs `no-usable-boundaries` and
 * rebuilds without timing — nine ceiling-cut segments would be worse than the fixed grid.
 */
export const HOP_TIMING_UNUSABLE = "unusable-sentence-timing"

/**
 * A truncated final slice below this reads as a glitch — too short to hear the switch or
 * read the language label — so it is dropped rather than flashed. Below one full segment,
 * above a perceptible minimum.
 */
export const MIN_FINAL_SLICE_SECONDS = 4

/** Mirrors the long-form excerpt offset (sourceResolution's LONG_FORM_OFFSET_RATIO). */
const HOP_OFFSET_RATIO = 0.15

/** One dub playing its segment: full identity plus the continuous media window it occupies. */
export type ShowcaseHop = {
  /** Non-null by construction — slug-less dubs never hop (they can announce no language). */
  languageSlug: string
  languageName: string | null
  hls: string
  muxPlaybackId: string | null
  window: ExcerptWindow
}

type SlugBearingDub = ReturnType<typeof playableDubs>[number] & {
  languageSlug: string
}

/**
 * Project one hop onto the player's stream contract. Shared by the shell's current-hop
 * projection and its next-hop preload, so the two can never drift (the ReelPlayer
 * matches them by hopHandoff's sameHopStream identity).
 */
export function hopToStream(hop: ShowcaseHop): ShowcaseStream {
  return {
    hls: hop.hls,
    languageSlug: hop.languageSlug,
    languageName: hop.languageName,
    muxPlaybackId: hop.muxPlaybackId,
    window: hop.window,
    claimsLanguage: true,
  }
}

/** Fisher-Yates over an injected rng; clamps j so a boundary rng (>=1) can't index past the array. */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(Math.max(Math.floor(rng() * (i + 1)), 0), i)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** First occurrence of each slug wins, so a centerpiece with a duplicate dub still hops once per language. */
function dedupeBySlug(dubs: readonly SlugBearingDub[]): SlugBearingDub[] {
  const seen = new Set<string>()
  const out: SlugBearingDub[] = []
  for (const dub of dubs) {
    if (seen.has(dub.languageSlug)) continue
    seen.add(dub.languageSlug)
    out.push(dub)
  }
  return out
}

/**
 * The opener plays first. English wins on exact slug identity; otherwise the default
 * resolver picks over the playable dubs (device locale → English-by-bcp47 → first).
 */
function pickOpener(dubs: readonly SlugBearingDub[]): SlugBearingDub {
  const english = dubs.find((dub) => dub.languageSlug === ENGLISH_SLUG)
  if (english) return english
  const resolved = resolveDefaultSlug(toDefaultSlugOptions(dubs), null)
  return dubs.find((dub) => dub.languageSlug === resolved) ?? dubs[0]
}

/** Contiguous slice lengths (all HOP_SEGMENT_SECONDS but a possibly-shorter final one) and where they start. */
function planTiming(
  planningDuration: number,
  desiredCount: number,
): { windowStart: number; hopLengths: number[] } | null {
  // Floored so a fractional duration can't round an end back into the credits tail.
  const creditsFreeEnd = Math.floor(planningDuration - CREDITS_TAIL_SECONDS)
  if (creditsFreeEnd < MIN_FINAL_SLICE_SECONDS) return null

  const desiredTotal = desiredCount * HOP_SEGMENT_SECONDS
  if (desiredTotal <= creditsFreeEnd) {
    // Every segment fits full; offset ~15% in, clamped so the last hop lands by the tail.
    const offset = Math.round(planningDuration * HOP_OFFSET_RATIO)
    const windowStart = Math.max(
      0,
      Math.min(offset, creditsFreeEnd - desiredTotal),
    )
    return {
      windowStart,
      hopLengths: Array(desiredCount).fill(HOP_SEGMENT_SECONDS),
    }
  }

  // Too short for the full plan: pack full segments from 0, then a shortened final slice
  // only if it clears the readable floor (below it, drop rather than flash).
  const fullSlices = Math.floor(creditsFreeEnd / HOP_SEGMENT_SECONDS)
  const remainder = creditsFreeEnd - fullSlices * HOP_SEGMENT_SECONDS
  const hopLengths: number[] = Array(fullSlices).fill(HOP_SEGMENT_SECONDS)
  if (
    hopLengths.length < desiredCount &&
    remainder >= MIN_FINAL_SLICE_SECONDS
  ) {
    hopLengths.push(remainder)
  }
  return hopLengths.length >= 2 ? { windowStart: 0, hopLengths } : null
}

// ── Sentence-aware timing (KTD-4/KTD-6/R1-R5) ───────────────────────

/** Spoken seconds inside [from, to): the union spans never overlap, so this never double-counts. */
function spokenCoverage(
  spans: SentenceTiming["dialogueSpans"],
  from: number,
  to: number,
): number {
  let total = 0
  for (const span of spans) {
    const lo = Math.max(span.start, from)
    const hi = Math.min(span.end, to)
    if (hi > lo) total += hi - lo
  }
  return total
}

/**
 * KTD-4: seed the window over the densest dialogue. Candidates are dialogue-span starts
 * (a segment should open on speech, not mid-silence); each is scored by spoken seconds in
 * a nominal span, highest wins, ties to earliest. Clamped so at least two segments can
 * still fit before the credits tail — the walk enforces the real end.
 */
function seedWindowStart(
  spans: SentenceTiming["dialogueSpans"],
  desiredCount: number,
  creditsFreeEnd: number,
): number {
  const nominalSpan = desiredCount * HOP_SEGMENT_SECONDS
  const maxStart = Math.max(0, creditsFreeEnd - HOP_SEGMENT_SECONDS * 2)
  const fitStarts = spans.map((s) => s.start).filter((s) => s <= maxStart)
  // All dialogue sits past the fittable range → open as early as that range allows.
  const candidates = fitStarts.length
    ? fitStarts
    : [Math.min(spans[0].start, maxStart)]

  let best = candidates[0]
  let bestCoverage = -1
  for (const start of candidates) {
    const coverage = spokenCoverage(spans, start, start + nominalSpan)
    if (coverage > bestCoverage) {
      bestCoverage = coverage
      best = start
    }
  }
  return best
}

/** Sorted unique span edges — the cue boundaries a ceiling-cut segment may end on (R3). */
function dialogueEdges(spans: SentenceTiming["dialogueSpans"]): number[] {
  const edges = new Set<number>()
  for (const span of spans) {
    edges.add(span.start)
    edges.add(span.end)
  }
  return [...edges].sort((a, b) => a - b)
}

/** Largest cue edge within [lo, hi], or null — where a ceiling-cut segment ends (R3). */
function largestEdgeWithin(
  edges: readonly number[],
  lo: number,
  hi: number,
): number | null {
  let best: number | null = null
  for (const edge of edges) {
    if (edge >= lo && edge <= hi) best = edge // edges sorted asc → last match is largest
  }
  return best
}

/**
 * Walk contiguous, sentence-aligned segments from the densest-dialogue seed (KTD-4). Each
 * segment runs at least 10s (R1) and ends at the first padded boundary past that (R2); a
 * segment with no boundary inside its ~30s ceiling is cut at the nearest cue edge (R3),
 * except the FIRST — an unalignable opener fails the whole track (KTD-6/AE6), as does a
 * plan of fewer than two switchable segments.
 */
function planSentenceWindows(
  planningDuration: number,
  desiredCount: number,
  timing: SentenceTiming,
): ExcerptWindow[] | typeof HOP_TIMING_UNUSABLE {
  const creditsFreeEnd = Math.floor(planningDuration - CREDITS_TAIL_SECONDS)
  if (creditsFreeEnd < HOP_SEGMENT_SECONDS * 2) return HOP_TIMING_UNUSABLE
  const { boundaries, dialogueSpans } = timing
  if (boundaries.length === 0 || dialogueSpans.length === 0) {
    return HOP_TIMING_UNUSABLE
  }

  const edges = dialogueEdges(dialogueSpans)
  const windows: ExcerptWindow[] = []
  let position = seedWindowStart(dialogueSpans, desiredCount, creditsFreeEnd)

  for (let i = 0; i < desiredCount; i++) {
    const minEnd = position + HOP_SEGMENT_SECONDS
    if (minEnd > creditsFreeEnd) break // no room for another >=10s segment before credits
    const ceilingEnd = Math.min(
      position + MAX_HOP_SEGMENT_SECONDS,
      creditsFreeEnd,
    )

    const boundary = boundaries.find((b) => b.switchTime >= minEnd)
    let end: number
    if (boundary && boundary.switchTime <= ceilingEnd) {
      end = boundary.switchTime // R2: first padded sentence pause past the 10s floor
    } else if (i === 0) {
      return HOP_TIMING_UNUSABLE // KTD-6/AE6: the opener must be sentence-aligned
    } else {
      end = largestEdgeWithin(edges, minEnd, ceilingEnd) ?? ceilingEnd // R3 ceiling cut
    }

    windows.push({ startSeconds: position, endSeconds: end })
    position = end
  }

  return windows.length >= 2 ? windows : HOP_TIMING_UNUSABLE
}

/**
 * Build the centerpiece's hop plan, or null when it can't showcase a language switch.
 *
 * The planning duration is the MINIMUM known duration across the scheduled dubs — dub
 * durations drift per language (repo law: dub duration is authoritative), and every hop
 * seeks its window into its own dub, so a window sized to the opener alone could seek a
 * shorter sibling past its end or into its credits. An unknown/null opener duration is
 * unschedulable-extended: the caller treats null as "play as an ordinary excerpt".
 */
export function buildHopSchedule(args: {
  dubs: readonly ShowcaseDubInput[] | null | undefined
  rng: () => number
}): ShowcaseHop[] | null
export function buildHopSchedule(args: {
  dubs: readonly ShowcaseDubInput[] | null | undefined
  rng: () => number
  sentenceTiming: SentenceTiming
}): ShowcaseHop[] | null | typeof HOP_TIMING_UNUSABLE
export function buildHopSchedule(args: {
  dubs: readonly ShowcaseDubInput[] | null | undefined
  rng: () => number
  sentenceTiming?: SentenceTiming
}): ShowcaseHop[] | null | typeof HOP_TIMING_UNUSABLE {
  const slugBearing = dedupeBySlug(
    playableDubs(args.dubs).filter(
      (dub): dub is SlugBearingDub => dub.languageSlug != null,
    ),
  )
  // Under two languages there is no switch to show — the caller uses the ordinary excerpt.
  if (slugBearing.length < 2) return null

  const opener = pickOpener(slugBearing)
  if (
    opener.durationSeconds == null ||
    !Number.isFinite(opener.durationSeconds) ||
    opener.durationSeconds <= 0
  ) {
    return null
  }

  const rest = slugBearing.filter(
    (dub) => dub.languageSlug !== opener.languageSlug,
  )
  const orderedDubs = [opener, ...shuffle(rest, args.rng)]
  const desiredCount = Math.min(orderedDubs.length, MAX_HOPS)

  // Clamp to the shortest KNOWN duration among the dubs that could be scheduled; an
  // unknown sibling duration is treated as opener-length (excluding it would shrink
  // the plan on missing metadata alone, and drift is small among dubs of one video).
  const planningDuration = orderedDubs
    .slice(0, desiredCount)
    .reduce(
      (min, dub) =>
        dub.durationSeconds != null &&
        Number.isFinite(dub.durationSeconds) &&
        dub.durationSeconds > 0
          ? Math.min(min, dub.durationSeconds)
          : min,
      opener.durationSeconds,
    )

  // KTD-1: sentence timing is a purely additive path. Absent, the code below is
  // byte-identical to before; present, the sentence-aware planner runs and may return
  // the KTD-6 unusable sentinel so the caller logs and rebuilds without timing.
  if (args.sentenceTiming) {
    const windows = planSentenceWindows(
      planningDuration,
      desiredCount,
      args.sentenceTiming,
    )
    if (windows === HOP_TIMING_UNUSABLE) return HOP_TIMING_UNUSABLE
    return windows.map((window, index) => {
      const dub = orderedDubs[index]
      return {
        languageSlug: dub.languageSlug,
        languageName: dub.languageName,
        hls: dub.hls,
        muxPlaybackId: dub.muxPlaybackId,
        window,
      }
    })
  }

  const timing = planTiming(planningDuration, desiredCount)
  if (!timing) return null

  const hops: ShowcaseHop[] = []
  let position = timing.windowStart
  timing.hopLengths.forEach((length, index) => {
    const dub = orderedDubs[index]
    const startSeconds = position
    position += length
    hops.push({
      languageSlug: dub.languageSlug,
      languageName: dub.languageName,
      hls: dub.hls,
      muxPlaybackId: dub.muxPlaybackId,
      window: { startSeconds, endSeconds: position },
    })
  })
  return hops
}
