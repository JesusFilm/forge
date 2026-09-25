/**
 * "Keep watching" (KTD11): Explore writes a one-shot intent and navigates; only
 * the watch route reads it. The route keeps only `slug` and `seed`, so a deep
 * link cannot set one. React-free: the route keeps these results in its state.
 */

import type { ProgressHold } from "../miniPlayer/playbackRequest"
import { encodeWatchSeed } from "../watchSeed"
import type { ClipWindow, FeedClip } from "./types"

/** KTD11: covers only the time from the tap to the route's first render. */
export const WATCH_INTENT_TTL_MS = 30_000

/**
 * KTD12: how long the R17 offer shows by default, and so how long the progress
 * hold lasts. A working value: the final one is an open product decision.
 */
export const KEEP_WATCHING_OFFER_DURATION_MS = 6_000

/** Where the hand-off came from, kept in page state for telemetry (R34). */
export type WatchIntentOrigin = "explore"

export type WatchIntent = {
  videoSlug: string
  /** Full-asset seconds: the point the viewer reached in the clip. */
  startSeconds: number
  audioLanguageSlug: string
  subtitleLanguageSlug: string | null
  subtitleOnly: boolean
  origin: WatchIntentOrigin
  /** Epoch ms of the tap. The time-to-live runs from here. */
  createdAt: number
}

export type WatchIntentStore = ReturnType<typeof createWatchIntentStore>

/** Holds at most one intent: a newer tap outranks an older one. */
export function createWatchIntentStore(now: () => number = () => Date.now()) {
  let pending: WatchIntent | null = null
  const fresh = (intent: WatchIntent) =>
    now() - intent.createdAt < WATCH_INTENT_TTL_MS
  return {
    put(intent: Omit<WatchIntent, "createdAt">): WatchIntent {
      pending = { ...intent, createdAt: now() }
      return pending
    },
    /** The fresh intent for this slug, or null. Never consumes, so a render
     *  that runs twice reads the same intent twice. */
    peek(videoSlug: string): WatchIntent | null {
      if (pending == null || pending.videoSlug !== videoSlug) return null
      return fresh(pending) ? pending : null
    },
    /** After the route commits the intent. A newer intent stays. */
    consume(intent: WatchIntent): void {
      if (pending === intent) pending = null
    },
    clear(): void {
      pending = null
    },
  }
}

let intents: WatchIntentStore | null = null

export function getWatchIntentStore(): WatchIntentStore {
  intents ??= createWatchIntentStore()
  return intents
}

/**
 * The start for a tap. A missing position (the tap came under the clip's
 * veil) or one outside the window starts at the clip's edge.
 */
export function keepWatchingStartSeconds(
  window: ClipWindow,
  positionSeconds: number | null,
): number {
  if (positionSeconds == null || !Number.isFinite(positionSeconds))
    return window.startSeconds
  return Math.min(
    Math.max(positionSeconds, window.startSeconds),
    window.endSeconds,
  )
}

export type KeepWatchingClip = Pick<
  FeedClip,
  | "slug"
  | "title"
  | "imageUrl"
  | "muxPlaybackId"
  | "audioLanguageSlug"
  | "subtitleLanguageSlug"
  | "subtitleOnly"
  | "window"
>

/**
 * R16, F2: writes the intent, then opens the watch page. The seed carries the
 * clip's own stream, so the page paints and plays at once. `positionSeconds`
 * is the clip player's time in the full asset; pass null under the veil.
 */
export function openKeepWatching(input: {
  clip: KeepWatchingClip
  positionSeconds: number | null
  navigate: (href: string) => void
  store?: WatchIntentStore
}): WatchIntent {
  const { clip } = input
  const intent = (input.store ?? getWatchIntentStore()).put({
    videoSlug: clip.slug,
    startSeconds: keepWatchingStartSeconds(clip.window, input.positionSeconds),
    audioLanguageSlug: clip.audioLanguageSlug,
    subtitleLanguageSlug: clip.subtitleLanguageSlug,
    subtitleOnly: clip.subtitleOnly,
    origin: "explore",
  })
  const seed = encodeWatchSeed({
    slug: clip.slug,
    title: clip.title,
    imageUrl: clip.imageUrl,
    playbackId: clip.muxPlaybackId,
  })
  input.navigate(`/watch/${encodeURIComponent(clip.slug)}?seed=${seed}`)
  return intent
}

/**
 * The intent's start in page state. It rides `resumeAtSeconds` while `live`.
 * `canonicalUrl` is the first source the page publishes once its dub settles.
 */
export type KeepWatchingStart =
  | { phase: "live"; seconds: number; canonicalUrl: string | null }
  | { phase: "spent" }

export type KeepWatchingState = {
  intent: WatchIntent
  start: KeepWatchingStart
  /** KTD12: true until an offer choice ends the progress hold. */
  holdActive: boolean
}

export function keepWatchingStateFor(
  intent: WatchIntent | null,
): KeepWatchingState | null {
  if (intent == null) return null
  return {
    intent,
    start: { phase: "live", seconds: intent.startSeconds, canonicalUrl: null },
    holdActive: true,
  }
}

/**
 * The page's `resumeAtSeconds`: the intent start over saved progress. A spent
 * start gives nothing, never the saved position, which the hold keeps stale
 * (AE6), so a later dub reload cannot jump there either.
 */
export function rankStartSeconds(
  start: KeepWatchingStart | null,
  savedResumeSeconds: number | null,
): number | null {
  if (start == null) return savedResumeSeconds
  return start.phase === "live" ? start.seconds : null
}

/**
 * KTD11 ends the start at the canonical stream's first `sourceLoad`, which
 * the route cannot see. `VideoPlayer` seeks once per published URL, so the
 * start stays live on the seed and the canonical URL, and a later URL spends it.
 */
export function advanceKeepWatching(
  state: KeepWatchingState,
  published: { url: string | null; settled: boolean },
): KeepWatchingState {
  const { start } = state
  if (start.phase === "spent") return state
  if (start.canonicalUrl == null) {
    if (!published.settled || published.url == null) return state
    return { ...state, start: { ...start, canonicalUrl: published.url } }
  }
  if (published.url === start.canonicalUrl) return state
  return { ...state, start: { phase: "spent" } }
}

/**
 * An R17 offer choice: it ends the hold, and a live start takes the chosen
 * position, so a canonical swap still to come lands there and not on the tap.
 */
export function keepWatchingAfterChoice(
  state: KeepWatchingState,
  seconds: number,
): KeepWatchingState {
  const { start } = state
  return {
    ...state,
    holdActive: false,
    start: start.phase === "live" ? { ...start, seconds } : start,
  }
}

/** KTD12: the hold the page publishes. Its id is stable for one intent, so a
 *  re-render never restarts the clock. */
export function keepWatchingProgressHold(
  state: KeepWatchingState | null,
): ProgressHold | null {
  if (state == null || !state.holdActive) return null
  return {
    id: `keep-watching:${state.intent.videoSlug}:${state.intent.createdAt}`,
    durationMs: KEEP_WATCHING_OFFER_DURATION_MS,
  }
}

/**
 * R43: the watch session's explicit languages. Only a subtitle-only clip
 * carries its subtitles over; a dubbed clip's captions were a mute aid, so
 * the saved subtitle setting applies.
 */
export function keepWatchingLanguages(intent: WatchIntent): {
  audioLanguageSlug: string
  subtitleLanguageSlug: string | null
  subtitlesOn: boolean
} {
  const carry = intent.subtitleOnly && intent.subtitleLanguageSlug != null
  return {
    audioLanguageSlug: intent.audioLanguageSlug,
    subtitleLanguageSlug: carry ? intent.subtitleLanguageSlug : null,
    subtitlesOn: carry,
  }
}
