/**
 * The clip queue (KTD6): pure decisions that choose the next clips from
 * the pool, the slate, the hydrations, the timing results, and the record.
 * Order (F3): the slate first (R25), then R21's tiers, with R30 and R31.
 */

import type { AdminLanguageForms } from "../../i18n/adminLanguage"
import { pickCardImage, type CardImageSource } from "../cardImage"
import { extractMuxPlaybackId, isMuxPlaybackId } from "../muxThumbnail"
import type { ExploreClipCandidatesData } from "../queries"
import { cleanStreamUrl, validateStreamingUrl } from "../validateUrl"
import {
  pickVideoText,
  readDescription,
  readTitle,
  videoTextVariables,
  type LocalizedText,
} from "../videoText"
import type { ClipTimingRequest, ClipTimingResult } from "./clipTiming"
import {
  eligibleStartsOnce,
  fallbackWindow,
  MIN_CLIP_VIDEO_SECONDS,
  overlaps,
  pickSentenceWindow,
  unitRandom,
  type EligibleStartsMemo,
  type MemoSlot,
  type RandomSource,
} from "./clipWindow"
import {
  isPoolEmpty,
  nonBlank,
  type ExplorePool,
  type PoolCandidate,
} from "./pool"
import type { ClipTiming } from "./sentenceTiming"
import { timingTrackOrder } from "./timingTrack"
import type { ClipCut, ClipWindow, ReadyClip } from "./types"

/** KTD6: computed clips ahead of the current one, the feed's queued clip included. */
export const CLIP_QUEUE_AHEAD = 2

/** KTD6: queued candidates per hydration request. */
export const HYDRATION_BATCH_SIZE = 3

/** KTD6: a cold first clip prefers a video no longer than this. The data
 *  probe found that a label does not predict length, so this reads the duration. */
export const FIRST_CLIP_MAX_SECONDS = 600

/** Hydrations held for a later clip. The oldest leaves first and rehydrates. */
const MAX_HELD_MEDIA = 60

export type CandidateVideo =
  ExploreClipCandidatesData["watchHomeVideos"][number]

/** A subtitle track as the ClipTimingSource walk reads it. */
export type TimingTrack = {
  vttSrc: string
  primary: boolean | null
  aiGenerated: boolean | null
  language: { slug: string | null }
}

/** One hydrated candidate, compact: what a clip and the ClipTimingSource walk need. */
export type CandidateMedia = {
  editionId: string | null
  streamUrl: string
  muxPlaybackId: string | null
  durationSeconds: number
  audioLanguageSlug: string
  imageUrl: string | null
  /** At most one track per KTD5 tier, in walk order. */
  tracks: TimingTrack[]
  /** R13: the feed-language track, or null. */
  captionVttSrc: string | null
  /** R9, R10: the hydration's text in the UI language, else English. */
  title: LocalizedText | null
  description: LocalizedText | null
  /** The `$textSlug` the hydration asked with. */
  textSlug: string
}

/** Absent: not hydrated. `unknown`: hydrated, timing not yet known. */
type Knowledge = ClipCut | "ineligible" | "unknown"

/** Why a pool fetch or a hydration failed. */
export type QueueFailure = "unreachable" | "transient"

type InFlight = {
  token: number
  kind: ClipQueueEffect["kind"]
  videoIds: readonly string[]
}

export type ClipQueueState = {
  feedLanguageSlug: string
  pool: ExplorePool | null
  /** Why the pool could not load. Null once a pool arrives. */
  poolFailure: QueueFailure | null
  candidates: ReadonlyMap<string, PoolCandidate>
  /** Shuffled video ids; a video moves to the back when it gives a clip. */
  dubbedOrder: readonly string[]
  subtitleOrder: readonly string[]
  /** Recommended video ids, in slate order. */
  slate: readonly string[]
  slateSpent: ReadonlySet<string>
  knowledge: ReadonlyMap<string, Knowledge>
  /** Insertion order is age. */
  media: ReadonlyMap<string, CandidateMedia>
  /** No free portion. Cleared by an R31 release. */
  full: ReadonlySet<string>
  /** A transient failure this request. Cleared by a clip or `retry`. */
  deferred: ReadonlySet<string>
  /** Sentence timing that arrived and waits for its cut. */
  pendingTiming: { videoId: string; vttSrc: string; timing: ClipTiming } | null
  /** KTD24: the ClipTimingSource answered `budget_exhausted` this visit. */
  probesExhausted: boolean
  ahead: readonly ReadyClip[]
  /** The clip the feed took last. Its window stays reserved. */
  handedOff: ReadyClip | null
  /** R30: the video of the clip the next clip follows. */
  lastVideoId: string | null
  /** Clips produced this session, a seeded clip included. */
  produced: number
  releasedThisRequest: boolean
  inFlight: InFlight | null
  nextToken: number
  /** A hydration failed. Nothing is asked for until `retry`. */
  blocked: QueueFailure | null
}

// The hook runs one effect, feeds its result to the matching `apply*` updater,
// and calls `advance` again. A result whose token no longer matches changes
// nothing, so a late answer for an old language or pool is dropped.
export type ClipQueueEffect =
  | {
      kind: "hydrate"
      token: number
      /** `$audioLanguageSlug` for `EXPLORE_CLIP_CANDIDATES`. */
      audioLanguageSlug: string
      coreIds: readonly string[]
    }
  | {
      kind: "acquire"
      token: number
      videoId: string
      request: ClipTimingRequest<TimingTrack>
    }
  | {
      kind: "release"
      token: number
      languageSlug: string
      /** For `releaseOldestForLanguage`. */
      count: number
    }

export type ClipQueueSignal = "offline" | "empty"

export type ClipQueueStep = {
  state: ClipQueueState
  effect: ClipQueueEffect | null
  /** R37 / R47. The feed reducer acts on it only while preparing. */
  signal: ClipQueueSignal | null
}

/** The record as the queue reads it (the ClipRecordStore satisfies it). */
export type ClipQueueRecord = {
  getWindows(videoId: string): readonly ClipWindow[]
  getVersion(): number
  /** Oldest first. */
  getEntries(): readonly { videoId: string; languageSlug: string }[]
}

export type ClipQueueContext = {
  random: RandomSource
  record: ClipQueueRecord
  /** The ClipTimingSource module's `eligibleStartsSlot`. */
  eligibleStartsSlot: (
    vttSrc: string,
    videoId: string,
  ) => MemoSlot<EligibleStartsMemo>
  /** 1 while the feed holds a queued clip that is not current yet, else 0. */
  clipsAheadInFeed: number
}

export type LanguageChangeEffect =
  | { kind: "fetchPool"; languageSlug: string }
  | { kind: "refreshRecommendations"; languageSlug: string }

// ── Construction and inputs ─────────────────────────────────────────

export function createClipQueue(feedLanguageSlug: string): ClipQueueState {
  return {
    feedLanguageSlug,
    pool: null,
    poolFailure: null,
    candidates: new Map(),
    dubbedOrder: [],
    subtitleOrder: [],
    slate: [],
    slateSpent: new Set(),
    knowledge: new Map(),
    media: new Map(),
    full: new Set(),
    deferred: new Set(),
    pendingTiming: null,
    probesExhausted: false,
    ahead: [],
    handedOff: null,
    lastVideoId: null,
    produced: 0,
    releasedThisRequest: false,
    inFlight: null,
    nextToken: 1,
    blocked: null,
  }
}

/** Forward Fisher–Yates, so a source that always answers 0 keeps the order. */
function shuffle<T>(list: readonly T[], random: RandomSource): T[] {
  const out = [...list]
  for (let i = 0; i < out.length - 1; i++) {
    const j = i + Math.floor(unitRandom(random) * (out.length - i))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function keepKeys<V>(
  map: ReadonlyMap<string, V>,
  keep: ReadonlyMap<string, unknown>,
): Map<string, V> {
  return new Map([...map].filter(([id]) => keep.has(id)))
}

/** A new or refreshed pool. A pool for another language is ignored. */
export function setPool(
  state: ClipQueueState,
  pool: ExplorePool,
  random: RandomSource,
): ClipQueueState {
  if (pool.languageSlug !== state.feedLanguageSlug) return state
  const candidates = new Map<string, PoolCandidate>()
  for (const c of [...pool.dubbed, ...pool.subtitleOnly]) {
    candidates.set(c.videoId, c)
  }
  const pending = state.pendingTiming
  return {
    ...state,
    pool,
    poolFailure: null,
    candidates,
    dubbedOrder: shuffle(
      pool.dubbed.map((c) => c.videoId),
      random,
    ),
    subtitleOrder: shuffle(
      pool.subtitleOnly.map((c) => c.videoId),
      random,
    ),
    knowledge: keepKeys(state.knowledge, candidates),
    media: keepKeys(state.media, candidates),
    full: new Set([...state.full].filter((id) => candidates.has(id))),
    deferred: new Set([...state.deferred].filter((id) => candidates.has(id))),
    pendingTiming:
      pending != null && candidates.has(pending.videoId) ? pending : null,
  }
}

/** The pool fetch failed. With a pool already in hand, nothing changes. */
export function poolFailed(
  state: ClipQueueState,
  reason: QueueFailure,
): ClipQueueState {
  return state.pool != null ? state : { ...state, poolFailure: reason }
}

/** Recommended Admin video ids (`targetMediaId`), in slate order, or null. */
export function setSlate(
  state: ClipQueueState,
  videoIds: readonly string[] | null,
): ClipQueueState {
  return { ...state, slate: videoIds ?? [], slateSpent: new Set() }
}

/** A warm open's stored clip (validated by `usableStoredClip`) goes first. */
export function seedClip(
  state: ClipQueueState,
  clip: ReadyClip,
): ClipQueueState {
  if (clip.feedLanguageSlug !== state.feedLanguageSlug) return state
  if (state.produced > 0 || state.ahead.length > 0) return state
  return {
    ...state,
    ahead: [clip],
    lastVideoId: clip.videoId,
    produced: 1,
  }
}

/** The feed takes the next clip (`clipQueued`). */
export function takeClip(state: ClipQueueState): {
  state: ClipQueueState
  clip: ReadyClip | null
} {
  const [clip, ...rest] = state.ahead
  if (clip == null) return { state, clip: null }
  return { state: { ...state, ahead: rest, handedOff: clip }, clip }
}

/** The clip to store beside the pool for the next warm open, or null. */
export function nextStorableClip(state: ClipQueueState): ReadyClip | null {
  return state.ahead[0] ?? null
}

/** True when the queue waits on a failure: the hook calls `retry` after a
 *  backoff, or on the offline state's retry. */
export function needsRetry(state: ClipQueueState): boolean {
  return (
    state.blocked != null ||
    state.poolFailure != null ||
    (state.inFlight == null && state.deferred.size > 0)
  )
}

export function retry(state: ClipQueueState): ClipQueueState {
  return { ...state, blocked: null, poolFailure: null, deferred: new Set() }
}

/** KTD24's budget is per visit. Call it with the ClipTimingSource's `resetVisit`. */
export function newVisit(state: ClipQueueState): ClipQueueState {
  return state.probesExhausted ? { ...state, probesExhausted: false } : state
}

/**
 * R24: the clips the feed already holds stay; the computed clips go. The
 * hook runs each effect once. A late result for the old language is dropped.
 */
export function changeLanguage(
  state: ClipQueueState,
  languageSlug: string,
): { state: ClipQueueState; effects: LanguageChangeEffect[] } {
  if (languageSlug === state.feedLanguageSlug) return { state, effects: [] }
  return {
    state: {
      ...createClipQueue(languageSlug),
      nextToken: state.nextToken,
      handedOff: state.handedOff,
      lastVideoId: state.handedOff?.videoId ?? null,
      produced: state.produced,
      probesExhausted: state.probesExhausted,
    },
    effects: [
      { kind: "fetchPool", languageSlug },
      { kind: "refreshRecommendations", languageSlug },
    ],
  }
}

// ── Results ─────────────────────────────────────────────────────────

function dubSeconds(
  lengthInMilliseconds: string | null | undefined,
  duration: number | null | undefined,
): number | null {
  const fromMs = Number(lengthInMilliseconds) / 1000
  if (nonBlank(lengthInMilliseconds) && Number.isFinite(fromMs) && fromMs > 0) {
    return fromMs
  }
  return typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration > 0
    ? duration
    : null
}

/** A present-but-blank field is a real shape, so it must not win the scan. */
function authoredImage(video: CandidateVideo): string | null {
  const images: CardImageSource[] = (video.images ?? []).map((image) => ({
    thumbnail: nonBlank(image.thumbnail) ? image.thumbnail : null,
    mobileCinematicHigh: nonBlank(image.mobileCinematicHigh)
      ? image.mobileCinematicHigh
      : null,
    mobileCinematicLow: nonBlank(image.mobileCinematicLow)
      ? image.mobileCinematicLow
      : null,
    videoStill: nonBlank(image.videoStill) ? image.videoStill : null,
  }))
  return pickCardImage(images, "card")
}

/**
 * R20. `preferredPlayableDub` falls back to other languages, so the dub must
 * be in exactly the asked-for language. A subtitle-only candidate also needs a
 * feed-language track on that dub's edition (CONCEPTS.md).
 */
function readCandidateMedia(
  video: CandidateVideo | undefined,
  candidate: PoolCandidate,
  feedLanguageSlug: string,
  forms: AdminLanguageForms,
): CandidateMedia | null {
  const audioLanguageSlug = audioSlugOf(candidate, feedLanguageSlug)
  const subtitleOnly = candidate.availability === "SUBTITLE_ONLY"
  const dub = video?.preferredPlayableDub
  if (video == null || dub == null) return null
  if (dub.language?.slug !== audioLanguageSlug) return null
  const streamUrl = cleanStreamUrl(dub.hls)
  if (streamUrl == null || !validateStreamingUrl(streamUrl)) return null
  const durationSeconds = dubSeconds(dub.lengthInMilliseconds, dub.duration)
  if (durationSeconds == null || durationSeconds < MIN_CLIP_VIDEO_SECONDS) {
    return null
  }
  const order = timingTrackOrder(dub, feedLanguageSlug)
  const captionVttSrc =
    order.find((c) => c.tier === "feedLanguage")?.vttSrc ?? null
  if (subtitleOnly && captionVttSrc == null) return null
  const playbackId = dub.muxVideo?.playbackId
  return {
    editionId: nonBlank(dub.videoEdition?.documentId)
      ? dub.videoEdition.documentId
      : null,
    streamUrl,
    muxPlaybackId: isMuxPlaybackId(playbackId)
      ? playbackId
      : extractMuxPlaybackId(streamUrl),
    durationSeconds,
    audioLanguageSlug,
    imageUrl: authoredImage(video),
    tracks: order.map(({ vttSrc, track }) => ({
      vttSrc,
      primary: track.primary ?? null,
      aiGenerated: track.aiGenerated ?? null,
      language: { slug: track.language?.slug ?? null },
    })),
    captionVttSrc,
    title: pickVideoText(video, forms, readTitle),
    description: pickVideoText(video, forms, readDescription),
    textSlug: videoTextVariables(forms).textSlug,
  }
}

function heldFor(
  state: ClipQueueState,
  kind: InFlight["kind"],
  token: number,
): InFlight | null {
  const flight = state.inFlight
  return flight != null && flight.kind === kind && flight.token === token
    ? flight
    : null
}

/** `watchHomeVideos` for a hydrate effect. A video it left out is ineligible. */
export function applyHydration(
  state: ClipQueueState,
  token: number,
  videos: readonly CandidateVideo[] | null | undefined,
  /** The forms whose `$textSlug` the request carried (KTD16). */
  forms: AdminLanguageForms,
): ClipQueueState {
  const flight = heldFor(state, "hydrate", token)
  if (flight == null) return state
  const byCoreId = new Map<string, CandidateVideo>()
  for (const video of videos ?? []) {
    if (nonBlank(video.coreId)) byCoreId.set(video.coreId, video)
  }
  const knowledge = new Map(state.knowledge)
  const media = new Map(state.media)
  for (const id of flight.videoIds) {
    const candidate = state.candidates.get(id)
    if (candidate == null) continue
    const read = readCandidateMedia(
      byCoreId.get(candidate.coreId),
      candidate,
      state.feedLanguageSlug,
      forms,
    )
    if (read == null) {
      knowledge.set(id, "ineligible")
      media.delete(id)
      continue
    }
    media.delete(id)
    media.set(id, read)
    const known = knowledge.get(id)
    // No track: KTD5 has nothing to read, so the verdict needs no probe.
    if (read.tracks.length === 0) knowledge.set(id, "fallback")
    else if (known !== "sentence" && known !== "fallback") {
      knowledge.set(id, "unknown")
    }
  }
  for (const id of media.keys()) {
    if (media.size <= MAX_HELD_MEDIA) break
    if (!flight.videoIds.includes(id)) media.delete(id)
  }
  return { ...state, knowledge, media, inFlight: null }
}

/** A hydrate effect failed. Nothing more is asked for until `retry`. */
export function hydrationFailed(
  state: ClipQueueState,
  token: number,
  reason: QueueFailure,
): ClipQueueState {
  if (heldFor(state, "hydrate", token) == null) return state
  return { ...state, inFlight: null, blocked: reason }
}

/** The ClipTimingSource's `acquire` answer for an acquire effect. */
export function applyTiming(
  state: ClipQueueState,
  token: number,
  result: ClipTimingResult,
): ClipQueueState {
  const flight = heldFor(state, "acquire", token)
  if (flight == null) return state
  const [videoId] = flight.videoIds
  const next: ClipQueueState = { ...state, inFlight: null }
  switch (result.status) {
    case "sentence":
      return {
        ...next,
        knowledge: new Map(state.knowledge).set(videoId, "sentence"),
        pendingTiming: {
          videoId,
          vttSrc: result.vttSrc,
          timing: result.timing,
        },
      }
    case "fallback":
      return {
        ...next,
        knowledge: new Map(state.knowledge).set(videoId, "fallback"),
      }
    case "transient":
      return { ...next, deferred: new Set(state.deferred).add(videoId) }
    case "budget_exhausted":
      return { ...next, probesExhausted: true }
  }
}

/** The hook ran `releaseOldestForLanguage` for a release effect. */
export function applyRelease(
  state: ClipQueueState,
  token: number,
): ClipQueueState {
  if (heldFor(state, "release", token) == null) return state
  return {
    ...state,
    inFlight: null,
    full: new Set(),
    releasedThisRequest: true,
  }
}

// ── Decisions ───────────────────────────────────────────────────────

type Move =
  | { kind: "hydrate"; audioLanguageSlug: string; videoIds: string[] }
  | { kind: "acquire"; videoId: string }
  | { kind: "cut"; videoId: string; cut: ClipCut }
  | { kind: "release"; count: number }
  | { kind: "empty" }
  | { kind: "wait" }

function audioSlugOf(
  candidate: PoolCandidate,
  feedLanguageSlug: string,
): string {
  return candidate.availability === "SUBTITLE_ONLY"
    ? candidate.watchLanguageSlug
    : feedLanguageSlug
}

function timingOf(state: ClipQueueState, id: string) {
  const known = state.knowledge.get(id)
  return known === "sentence" || known === "fallback" ? known : "unknown"
}

/** The dubbed order, with short videos first for a cold first clip. */
function orderDubbed(state: ClipQueueState): readonly string[] {
  if (state.produced > 0) return state.dubbedOrder
  const isShort = (id: string) => {
    const seconds = state.candidates.get(id)?.durationSeconds
    return seconds != null && seconds <= FIRST_CLIP_MAX_SECONDS
  }
  return [
    ...state.dubbedOrder.filter(isShort),
    ...state.dubbedOrder.filter((id) => !isShort(id)),
  ]
}

function slateIds(state: ClipQueueState): string[] {
  return state.slate.filter(
    (id) =>
      !state.slateSpent.has(id) &&
      state.candidates.get(id)?.availability === "AUDIO",
  )
}

function nextMove(state: ClipQueueState, ctx: ClipQueueContext): Move {
  const attempt = (allowPrevious: boolean): Move | null => {
    const skip = (id: string) =>
      state.knowledge.get(id) === "ineligible" ||
      state.full.has(id) ||
      state.deferred.has(id) ||
      (!allowPrevious && id === state.lastVideoId)

    const work = (
      id: string,
      cut: ClipCut,
      lookahead: readonly string[],
    ): Move => {
      if (!state.media.has(id)) {
        const audio = audioSlugOf(
          state.candidates.get(id)!,
          state.feedLanguageSlug,
        )
        const batch = [id]
        for (const other of lookahead) {
          if (batch.length >= HYDRATION_BATCH_SIZE) break
          const c = state.candidates.get(other)
          if (c == null || batch.includes(other) || state.media.has(other)) {
            continue
          }
          if (skip(other) || audioSlugOf(c, state.feedLanguageSlug) !== audio) {
            continue
          }
          batch.push(other)
        }
        return { kind: "hydrate", audioLanguageSlug: audio, videoIds: batch }
      }
      if (cut === "fallback") return { kind: "cut", videoId: id, cut }
      return state.pendingTiming?.videoId === id
        ? { kind: "cut", videoId: id, cut }
        : { kind: "acquire", videoId: id }
    }

    const exhausted = state.probesExhausted
    // KTD24: no new probe past the budget, so an unprobed video cuts by R23.
    const cutFor = (id: string): ClipCut => {
      const timing = timingOf(state, id)
      return timing === "fallback" || (timing === "unknown" && exhausted)
        ? "fallback"
        : "sentence"
    }
    const dubbed = orderDubbed(state)
    const slate = slateIds(state)
    const dubbedLookahead = [...slate, ...dubbed]

    // R25: recommended videos first, whatever their tier.
    for (const id of slate) {
      if (skip(id)) continue
      return work(id, cutFor(id), dubbedLookahead)
    }
    // R21 tier 1: sentence-cut dubbed.
    for (const id of dubbed) {
      if (skip(id) || cutFor(id) === "fallback") continue
      return work(id, "sentence", dubbedLookahead)
    }
    // Tier 2: fallback dubbed, from videos already known to have no timing.
    for (const id of dubbed) {
      if (!skip(id) && timingOf(state, id) === "fallback") {
        return work(id, "fallback", dubbedLookahead)
      }
    }
    // KTD24: past the budget, an unprobed dubbed video still outranks tier 3.
    if (exhausted) {
      for (const id of dubbed) {
        if (!skip(id) && timingOf(state, id) === "unknown") {
          return work(id, "fallback", dubbedLookahead)
        }
      }
    }
    // Tier 3: subtitle-only, with the feed-language track shown (AE5).
    for (const id of state.subtitleOrder) {
      if (skip(id)) continue
      return work(id, cutFor(id), state.subtitleOrder)
    }
    return null
  }

  const found = attempt(false)
  if (found != null) return found

  const eligible = [...state.candidates.keys()].filter(
    (id) => state.knowledge.get(id) !== "ineligible",
  )
  if (eligible.length === 0) return { kind: "empty" }
  // R30: a repeat is allowed only when one eligible video remains.
  if (eligible.length === 1 && eligible[0] === state.lastVideoId) {
    return attempt(true) ?? { kind: "wait" }
  }
  // A transient failure may still supply a clip after a retry.
  if (eligible.some((id) => state.deferred.has(id))) return { kind: "wait" }

  if (!state.releasedThisRequest) {
    const count = releaseCount(state, ctx.record, eligible)
    if (count > 0) return { kind: "release", count }
  }
  // R31: the feed never ends. A repeat beats a stop.
  return attempt(true) ?? { kind: "wait" }
}

/**
 * R31: the oldest entries for this language, up to and including the first
 * entry of an eligible video other than the previous one, so one release
 * frees a portion that R30 lets the next clip use.
 */
function releaseCount(
  state: ClipQueueState,
  record: ClipQueueRecord,
  eligible: readonly string[],
): number {
  const others = new Set(eligible.filter((id) => id !== state.lastVideoId))
  const entries = record
    .getEntries()
    .filter((entry) => entry.languageSlug === state.feedLanguageSlug)
  const index = entries.findIndex((entry) => others.has(entry.videoId))
  return index >= 0 ? index + 1 : entries.length
}

/** Computed clips are not in the record until they play, so hold their windows. */
function reservedWindows(state: ClipQueueState, videoId: string) {
  const held = state.handedOff ? [...state.ahead, state.handedOff] : state.ahead
  return held.filter((c) => c.videoId === videoId).map((c) => c.window)
}

function cutWindow(
  state: ClipQueueState,
  ctx: ClipQueueContext,
  videoId: string,
  cut: ClipCut,
  media: CandidateMedia,
): ClipWindow | "full" | "ineligible" {
  const recorded = ctx.record.getWindows(videoId)
  const reserved = reservedWindows(state, videoId)
  if (cut === "fallback") {
    if (media.durationSeconds < MIN_CLIP_VIDEO_SECONDS) return "ineligible"
    return (
      fallbackWindow(
        media.durationSeconds,
        [...recorded, ...reserved],
        ctx.random,
      ) ?? "full"
    )
  }
  const pending = state.pendingTiming!
  const eligible = eligibleStartsOnce(
    ctx.eligibleStartsSlot(pending.vttSrc, videoId),
    pending.timing,
    { version: ctx.record.getVersion(), windows: recorded },
  )
  // The memo keys on the record version, so reserved windows filter after it.
  const open =
    reserved.length === 0
      ? eligible
      : eligible.filter((w) => !reserved.some((r) => overlaps(w, r)))
  return pickSentenceWindow(open, ctx.random) ?? "full"
}

function readyClip(
  state: ClipQueueState,
  candidate: PoolCandidate,
  media: CandidateMedia,
  window: ClipWindow,
  cut: ClipCut,
): ReadyClip {
  return {
    ...candidate,
    // The inventory's text is in the feed language; the hydration's rows
    // follow the UI language (R9), and only a missing row keeps it.
    title: media.title?.text ?? candidate.title,
    titleLang: media.title?.lang ?? null,
    description: media.description?.text ?? candidate.description,
    descriptionLang: media.description?.lang ?? null,
    textSlug: media.textSlug,
    // The hydrated dub is the one that plays.
    durationSeconds: media.durationSeconds,
    muxPlaybackId: media.muxPlaybackId,
    imageUrl: media.imageUrl,
    feedLanguageSlug: state.feedLanguageSlug,
    streamUrl: media.streamUrl,
    audioLanguageSlug: media.audioLanguageSlug,
    subtitleLanguageSlug:
      media.captionVttSrc != null ? state.feedLanguageSlug : null,
    subtitleVttSrc: media.captionVttSrc,
    subtitleOnly: candidate.availability === "SUBTITLE_ONLY",
    window,
    cut,
  }
}

/** Random fill: every video gets a clip before any video gets a second one. */
function toBack(order: readonly string[], id: string): readonly string[] {
  return order.includes(id) ? [...order.filter((x) => x !== id), id] : order
}

function pushClip(state: ClipQueueState, clip: ReadyClip): ClipQueueState {
  return {
    ...state,
    ahead: [...state.ahead, clip],
    lastVideoId: clip.videoId,
    produced: state.produced + 1,
    dubbedOrder: toBack(state.dubbedOrder, clip.videoId),
    subtitleOrder: toBack(state.subtitleOrder, clip.videoId),
    slateSpent: new Set(state.slateSpent).add(clip.videoId),
    deferred: new Set(),
    releasedThisRequest: false,
  }
}

function applyCut(
  state: ClipQueueState,
  ctx: ClipQueueContext,
  videoId: string,
  cut: ClipCut,
): ClipQueueState {
  const candidate = state.candidates.get(videoId)!
  const media = state.media.get(videoId)!
  const outcome = cutWindow(state, ctx, videoId, cut, media)
  const next: ClipQueueState =
    state.pendingTiming?.videoId === videoId
      ? { ...state, pendingTiming: null }
      : state
  if (outcome === "ineligible") {
    return {
      ...next,
      knowledge: new Map(next.knowledge).set(videoId, "ineligible"),
    }
  }
  if (outcome === "full") {
    return { ...next, full: new Set(next.full).add(videoId) }
  }
  return pushClip(next, readyClip(next, candidate, media, outcome, cut))
}

function nothingPlayed(state: ClipQueueState): boolean {
  return state.produced === 0 && state.ahead.length === 0
}

function none(state: ClipQueueState): ClipQueueStep {
  return { state, effect: null, signal: null }
}

/**
 * The next effect, or none. Cuts that need no request happen here, so one
 * call can add clips. It asks for nothing while a request is in flight, or
 * while the feed and the queue already hold `CLIP_QUEUE_AHEAD` clips.
 */
export function advance(
  state: ClipQueueState,
  ctx: ClipQueueContext,
): ClipQueueStep {
  let current = state
  // Each pass adds a clip or marks one candidate; this only stops a bug.
  const maxPasses = current.candidates.size * 3 + CLIP_QUEUE_AHEAD + 8
  for (let pass = 0; pass < maxPasses; pass++) {
    if (current.pool == null) {
      return {
        state: current,
        effect: null,
        signal: current.poolFailure === "unreachable" ? "offline" : null,
      }
    }
    if (isPoolEmpty(current.pool)) {
      return { state: current, effect: null, signal: "empty" }
    }
    if (current.inFlight != null) return none(current)
    if (current.blocked != null) {
      return {
        state: current,
        effect: null,
        signal:
          current.blocked === "unreachable" && nothingPlayed(current)
            ? "offline"
            : null,
      }
    }
    if (current.ahead.length + ctx.clipsAheadInFeed >= CLIP_QUEUE_AHEAD) {
      return none(current)
    }

    const move = nextMove(current, ctx)
    const token = current.nextToken
    switch (move.kind) {
      case "cut":
        current = applyCut(current, ctx, move.videoId, move.cut)
        continue
      case "hydrate":
        return {
          state: {
            ...current,
            nextToken: token + 1,
            inFlight: { token, kind: "hydrate", videoIds: move.videoIds },
          },
          effect: {
            kind: "hydrate",
            token,
            audioLanguageSlug: move.audioLanguageSlug,
            coreIds: move.videoIds.map(
              (id) => current.candidates.get(id)!.coreId,
            ),
          },
          signal: null,
        }
      case "acquire": {
        const media = current.media.get(move.videoId)!
        return {
          state: {
            ...current,
            nextToken: token + 1,
            inFlight: { token, kind: "acquire", videoIds: [move.videoId] },
          },
          effect: {
            kind: "acquire",
            token,
            videoId: move.videoId,
            request: {
              videoId: move.videoId,
              editionId: media.editionId,
              playingDub: { videoEdition: { subtitles: media.tracks } },
              feedLanguageSlug: current.feedLanguageSlug,
              dubDurationSeconds: media.durationSeconds,
            },
          },
          signal: null,
        }
      }
      case "release":
        return {
          state: {
            ...current,
            nextToken: token + 1,
            inFlight: { token, kind: "release", videoIds: [] },
          },
          effect: {
            kind: "release",
            token,
            languageSlug: current.feedLanguageSlug,
            count: move.count,
          },
          signal: null,
        }
      case "empty":
        return { state: current, effect: null, signal: "empty" }
      case "wait":
        return none(current)
    }
  }
  return none(current)
}
