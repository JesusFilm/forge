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
import { playableDubs, type ShowcaseDubInput } from "./languageRotation"
import { CREDITS_TAIL_SECONDS } from "./sourceResolution"
import type { ExcerptWindow } from "./types"

/** English's unique language slug — exact identity, never a bcp47 prefix (en-nai collides). */
const ENGLISH_SLUG = "english"

/** One segment holds a single dub before the audio switches (R8: "~10s per segment"). */
export const HOP_SEGMENT_SECONDS = 10

/** R8/R9 ceiling: at most 9 languages, so at most 9x10 = 90s total. */
export const MAX_HOPS = 9

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
  const options = dubs.map((dub) => ({
    slug: dub.languageSlug,
    bcp47: dub.bcp47,
    languageSlug: dub.languageSlug,
  }))
  const resolved = resolveDefaultSlug(options, null)
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

/**
 * Build the centerpiece's hop plan, or null when it can't showcase a language switch.
 *
 * The opener dub's duration is the planning duration — dub durations drift per language
 * (repo law: dub duration is authoritative) and the opener establishes the media timeline
 * every hop shares. An unknown/null opener duration is unschedulable-extended: the caller
 * treats null as "play as an ordinary excerpt".
 */
export function buildHopSchedule(args: {
  dubs: readonly ShowcaseDubInput[] | null | undefined
  rng: () => number
}): ShowcaseHop[] | null {
  const slugBearing = dedupeBySlug(
    playableDubs(args.dubs).filter(
      (dub): dub is SlugBearingDub => dub.languageSlug != null,
    ),
  )
  // Under two languages there is no switch to show — the caller uses the ordinary excerpt.
  if (slugBearing.length < 2) return null

  const opener = pickOpener(slugBearing)
  const planningDuration = opener.durationSeconds
  if (
    planningDuration == null ||
    !Number.isFinite(planningDuration) ||
    planningDuration <= 0
  ) {
    return null
  }

  const rest = slugBearing.filter(
    (dub) => dub.languageSlug !== opener.languageSlug,
  )
  const orderedDubs = [opener, ...shuffle(rest, args.rng)]
  const desiredCount = Math.min(orderedDubs.length, MAX_HOPS)

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
