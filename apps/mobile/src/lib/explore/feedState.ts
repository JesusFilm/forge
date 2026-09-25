/**
 * The Explore feed's one state owner: phases, slot roles, clip history, pause
 * intent, and player mode. The feed players, the pager, and the overlay all
 * derive from one state per commit (KTD2). Timers and players live outside.
 */

import { launchDemoted, standbyErrorCountsTowardDemotion } from "./playerMode"
import type { PlayerMode } from "./playerMode"
import type { FeedClip, ReadyClip } from "./types"

/** KTD13: a tab switch or a background keeps the active source this long. */
export const BLUR_RELEASE_GRACE_MS = 10_000

/** The two long-lived feed players. One-player mode uses only the active one. */
export type PlayerId = "a" | "b"

export type FeedPhase =
  | "unvisited"
  | "preparing"
  | "offline"
  | "empty"
  | "veiled"
  | "playing"
  | "paused"
  | "clipFailed"
  | "blurred"

type ReturnPhase = Exclude<FeedPhase, "unvisited" | "blurred">

export type BlurCause = "tabSwitch" | "background" | "keepWatching"

export type TravelDirection = "forward" | "backward"

/** `pending` means assigned and not yet loaded; the player loads it at rest. */
export type SlotStatus = "pending" | "ready" | "failed"

/**
 * One player's assignment. Every assignment gets a new token, and an event
 * whose token no player holds is dropped, so a late load never acts (KTD25).
 */
export type PlayerSlot = {
  clip: FeedClip
  token: number
  startAtSeconds: number
  status: SlotStatus
}

export type SlotView = PlayerSlot & { player: PlayerId }

export type BlurRecord = {
  cause: BlurCause
  resumeTo: ReturnPhase
  /** The active clip's position at the blur, for a reload after a release. */
  positionSeconds: number | null
}

export type FeedState = {
  phase: FeedPhase
  playerMode: PlayerMode
  /** Standby errors this launch that count toward a demotion (KTD3). */
  standbyErrors: number
  /** Set once this launch demotes; the feed then stores the demotion. */
  demotedThisLaunch: boolean
  /** Every clip seen this session, oldest first (R41). */
  history: readonly FeedClip[]
  /** Index of the current clip in `history`, or -1 before the first clip. */
  cursor: number
  /** The queue's next clip, reserved for a swipe up from the end of history. */
  queued: FeedClip | null
  direction: TravelDirection
  active: PlayerId
  slots: Record<PlayerId, PlayerSlot | null>
  nextToken: number
  /** The active token whose motion is confirmed; sound waits for it (KTD2). */
  confirmedToken: number | null
  viewerPaused: boolean
  systemPaused: boolean
  /** Share or "more" is open (R44). */
  overlay: { wasPlaying: boolean } | null
  /** False from a swipe until the pager's rest event; loads wait for it. */
  pagerAtRest: boolean
  blur: BlurRecord | null
}

export type FeedEvent =
  /**
   * `playerMode` applies at the first focus only. A return from the
   * background is a focus too.
   */
  | { type: "focus"; playerMode: PlayerMode }
  | { type: "blur"; positionSeconds: number | null }
  | { type: "background"; positionSeconds: number | null }
  | { type: "keepWatching"; positionSeconds: number | null }
  | { type: "graceExpired" }
  | { type: "clipQueued"; clip: ReadyClip }
  | { type: "offline" }
  | { type: "empty" }
  | { type: "retry" }
  | { type: "swipeNext" }
  | { type: "swipePrevious" }
  | { type: "rest" }
  /** The source loaded and the start seek landed. */
  | { type: "loaded"; token: number }
  /** Each rise of the player's playing edge, not only the first one. */
  | { type: "playing"; token: number }
  /** A source error, or a second missed start seek. */
  | { type: "error"; token: number; msSinceSourceSet: number }
  /** The active clip's veil timeout. */
  | { type: "timeout"; token: number }
  | { type: "tap" }
  | { type: "systemPause" }
  | { type: "overlayOpen" }
  | { type: "overlayClose" }

export type ReleaseRequest = {
  standby: "keep" | "release"
  /** "afterGrace": arm BLUR_RELEASE_GRACE_MS, then send `graceExpired`. */
  active: "keep" | "afterGrace" | "release"
}

export const INITIAL_FEED_STATE: FeedState = {
  phase: "unvisited",
  playerMode: "two",
  standbyErrors: 0,
  demotedThisLaunch: false,
  history: [],
  cursor: -1,
  queued: null,
  direction: "forward",
  active: "a",
  slots: { a: null, b: null },
  nextToken: 1,
  confirmedToken: null,
  viewerPaused: false,
  systemPaused: false,
  overlay: null,
  pagerAtRest: true,
  blur: null,
}

const CLIP_PHASES: ReadonlySet<FeedPhase> = new Set([
  "veiled",
  "playing",
  "paused",
  "clipFailed",
])

/** Copies only what a replay needs, so no hydration object enters history. */
export function toFeedClip(clip: ReadyClip): FeedClip {
  return {
    videoId: clip.videoId,
    coreId: clip.coreId,
    slug: clip.slug,
    title: clip.title,
    description: clip.description,
    imageUrl: clip.imageUrl,
    muxPlaybackId: clip.muxPlaybackId,
    streamUrl: clip.streamUrl,
    feedLanguageSlug: clip.feedLanguageSlug,
    audioLanguageSlug: clip.audioLanguageSlug,
    subtitleLanguageSlug: clip.subtitleLanguageSlug,
    subtitleVttSrc: clip.subtitleVttSrc,
    subtitleOnly: clip.subtitleOnly,
    window: {
      startSeconds: clip.window.startSeconds,
      endSeconds: clip.window.endSeconds,
    },
    cut: clip.cut,
  }
}

// ── Selectors ───────────────────────────────────────────────────────

export function currentClip(state: FeedState): FeedClip | null {
  return state.history[state.cursor] ?? null
}

export function previousClip(state: FeedState): FeedClip | null {
  return state.cursor > 0 ? state.history[state.cursor - 1] : null
}

export function nextClip(state: FeedState): FeedClip | null {
  return state.history[state.cursor + 1] ?? state.queued
}

export function canSwipeNext(state: FeedState): boolean {
  return CLIP_PHASES.has(state.phase) && nextClip(state) != null
}

export function canSwipePrevious(state: FeedState): boolean {
  return CLIP_PHASES.has(state.phase) && state.cursor > 0
}

/** The queue supplies a clip only at the end of history (R41). */
export function needsClip(state: FeedState): boolean {
  if (state.phase === "preparing") return state.history.length === 0
  if (!CLIP_PHASES.has(state.phase)) return false
  return state.queued == null && state.cursor === state.history.length - 1
}

function slotView(state: FeedState, player: PlayerId): SlotView | null {
  const slot = state.slots[player]
  return slot == null ? null : { ...slot, player }
}

export function activeSlot(state: FeedState): SlotView | null {
  return slotView(state, state.active)
}

/** Null in one-player mode, where the standby view is unmounted (KTD3). */
export function standbySlot(state: FeedState): SlotView | null {
  if (state.playerMode === "one") return null
  return slotView(state, otherPlayer(state.active))
}

/** The one player that may have sound; the saved mute choice still applies. */
export function audiblePlayer(state: FeedState): PlayerId | null {
  if (state.phase !== "playing" || state.confirmedToken == null) return null
  return state.slots[state.active]?.token === state.confirmedToken
    ? state.active
    : null
}

/** Whether the active clip should play. In Veiled, the gate plays it on load. */
export function activeWantsPlay(state: FeedState): boolean {
  if (state.phase === "playing") return true
  return state.phase === "veiled" && !pauseHeld(state)
}

export function veilVisible(state: FeedState): boolean {
  return state.phase === "veiled"
}

export function isClipFailed(state: FeedState): boolean {
  return state.phase === "clipFailed"
}

export function releaseRequest(state: FeedState): ReleaseRequest {
  if (state.phase !== "blurred") return { standby: "keep", active: "keep" }
  return {
    standby: "release",
    active: state.slots[state.active] == null ? "release" : "afterGrace",
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function otherPlayer(player: PlayerId): PlayerId {
  return player === "a" ? "b" : "a"
}

function pauseHeld(state: FeedState): boolean {
  return state.viewerPaused || state.systemPaused || state.overlay != null
}

function setSlot(
  state: FeedState,
  player: PlayerId,
  slot: PlayerSlot | null,
): FeedState {
  return { ...state, slots: { ...state.slots, [player]: slot } }
}

function assign(
  state: FeedState,
  player: PlayerId,
  clip: FeedClip,
  startAtSeconds: number,
): FeedState {
  const slot: PlayerSlot = {
    clip,
    token: state.nextToken,
    startAtSeconds,
    status: "pending",
  }
  return { ...setSlot(state, player, slot), nextToken: state.nextToken + 1 }
}

function findSlot(
  state: FeedState,
  token: number,
): { player: PlayerId; slot: PlayerSlot } | null {
  for (const player of ["a", "b"] as const) {
    const slot = state.slots[player]
    if (slot?.token === token) return { player, slot }
  }
  return null
}

/** KTD25: the standby loads in the direction of travel. */
function standbyTarget(state: FeedState): FeedClip | null {
  if (state.playerMode === "one") return null
  if (state.direction === "backward") {
    return previousClip(state) ?? nextClip(state)
  }
  return nextClip(state)
}

/**
 * Points the standby at its target. A player that was just active always
 * restarts, because a replay starts at the clip's own start (R41).
 */
function syncStandby(state: FeedState, restart: boolean): FeedState {
  const player = otherPlayer(state.active)
  const target = standbyTarget(state)
  const slot = state.slots[player]
  if (target == null) return slot == null ? state : setSlot(state, player, null)
  if (!restart && slot?.clip === target) return state
  return assign(state, player, target, target.window.startSeconds)
}

function resumePosition(clip: FeedClip, positionSeconds: number | null) {
  const { startSeconds, endSeconds } = clip.window
  if (positionSeconds == null) return startSeconds
  const inside = positionSeconds >= startSeconds && positionSeconds < endSeconds
  return inside ? positionSeconds : startSeconds
}

// ── Transitions ─────────────────────────────────────────────────────

function swipe(state: FeedState, direction: TravelDirection): FeedState {
  if (!CLIP_PHASES.has(state.phase)) return state
  const cursor = direction === "forward" ? state.cursor + 1 : state.cursor - 1
  if (cursor < 0) return state
  let history = state.history
  let queued = state.queued
  let target: FeedClip | undefined = history[cursor]
  if (target == null && direction === "forward" && queued != null) {
    target = queued
    history = [...history, queued]
    queued = null
  }
  if (target == null) return state

  const moved: FeedState = {
    ...state,
    history,
    queued,
    cursor,
    direction,
    pagerAtRest: false,
    confirmedToken: null,
    viewerPaused: false,
    systemPaused: false,
    overlay: null,
  }
  if (state.playerMode === "one") {
    const reloaded = assign(
      moved,
      state.active,
      target,
      target.window.startSeconds,
    )
    return { ...reloaded, phase: "veiled" }
  }

  // KTD2: roles swap on every swipe, and a preloaded standby plays with no veil.
  const incoming = otherPlayer(state.active)
  const preloaded = state.slots[incoming]
  const reuse = preloaded?.clip === target && preloaded.status !== "failed"
  let next: FeedState = { ...moved, active: incoming }
  if (!reuse) next = assign(next, incoming, target, target.window.startSeconds)
  next = syncStandby(next, true)
  const ready = reuse && preloaded.status === "ready"
  return { ...next, phase: ready ? "playing" : "veiled" }
}

function leave(
  state: FeedState,
  cause: BlurCause,
  positionSeconds: number | null,
): FeedState {
  if (state.phase === "unvisited") return state
  if (state.phase === "blurred") {
    // "Keep watching" and the tab's blur can arrive in either order.
    if (cause !== "keepWatching" || state.blur == null) return state
    if (state.blur.cause === "keepWatching") return state
    const released = setSlot(state, state.active, null)
    return { ...released, blur: { ...state.blur, cause } }
  }
  let next = setSlot(state, otherPlayer(state.active), null)
  if (cause === "keepWatching") next = setSlot(next, state.active, null)
  return {
    ...next,
    phase: "blurred",
    confirmedToken: null,
    blur: { cause, resumeTo: state.phase, positionSeconds },
  }
}

function returnFromBlur(state: FeedState): FeedState {
  const blur = state.blur
  if (blur == null) return state
  const base: FeedState = { ...state, blur: null, systemPaused: false }
  const clip = currentClip(state)
  if (clip == null) return { ...base, phase: blur.resumeTo }

  const slot = state.slots[state.active]
  let next: FeedState
  if (slot == null) {
    const start = resumePosition(clip, blur.positionSeconds)
    next = { ...assign(base, state.active, clip, start), phase: "veiled" }
  } else if (slot.status === "failed" || blur.resumeTo === "clipFailed") {
    next = { ...base, phase: "clipFailed" }
  } else if (blur.resumeTo === "veiled") {
    next = { ...base, phase: "veiled" }
  } else {
    // R45: a viewer pause survives the return; a system pause does not.
    next = { ...base, phase: pauseHeld(base) ? "paused" : "playing" }
  }
  return syncStandby(next, false)
}

function queueClip(state: FeedState, ready: ReadyClip): FeedState {
  const clip = toFeedClip(ready)
  if (state.history.length === 0) {
    if (state.phase === "preparing") {
      const started = assign(
        { ...state, history: [clip], cursor: 0 },
        state.active,
        clip,
        clip.window.startSeconds,
      )
      return syncStandby({ ...started, phase: "veiled" }, false)
    }
    // The first clip can land while the viewer is away; it loads on return.
    if (state.phase === "blurred" && state.blur?.resumeTo === "preparing") {
      return {
        ...state,
        history: [clip],
        cursor: 0,
        blur: { ...state.blur, resumeTo: "veiled" },
      }
    }
    return state
  }
  // A preloaded look-ahead is kept; the queue offers again when asked.
  if (state.queued != null) return state
  const next: FeedState = { ...state, queued: clip }
  return CLIP_PHASES.has(state.phase) ? syncStandby(next, false) : next
}

function settleQueueOutcome(
  state: FeedState,
  phase: "offline" | "empty",
): FeedState {
  if (state.phase === "preparing") return { ...state, phase }
  if (state.phase === "blurred" && state.blur?.resumeTo === "preparing") {
    return { ...state, blur: { ...state.blur, resumeTo: phase } }
  }
  return state
}

function onLoaded(state: FeedState, token: number): FeedState {
  const found = findSlot(state, token)
  if (found == null || found.slot.status !== "pending") return state
  const next = setSlot(state, found.player, { ...found.slot, status: "ready" })
  // KTD14: the veil can lift with no play, when a pause is still held.
  if (found.player === state.active && state.phase === "veiled") {
    return pauseHeld(next) ? { ...next, phase: "paused" } : next
  }
  return next
}

function onPlaying(state: FeedState, token: number): FeedState {
  const found = findSlot(state, token)
  if (found == null || found.player !== state.active) return state
  if (state.phase === "veiled") {
    const next: FeedState = {
      ...setSlot(state, found.player, { ...found.slot, status: "ready" }),
      confirmedToken: token,
    }
    return { ...next, phase: pauseHeld(next) ? "paused" : "playing" }
  }
  if (state.phase === "playing" || state.phase === "paused") {
    return state.confirmedToken === token
      ? state
      : { ...state, confirmedToken: token }
  }
  return state
}

function onError(
  state: FeedState,
  token: number,
  msSinceSourceSet: number,
): FeedState {
  const found = findSlot(state, token)
  if (found == null || found.slot.status === "failed") return state
  const failed = setSlot(state, found.player, {
    ...found.slot,
    status: "failed",
  })
  if (found.player === state.active) {
    const live =
      state.phase === "veiled" ||
      state.phase === "playing" ||
      state.phase === "paused"
    return live ? { ...failed, phase: "clipFailed" } : failed
  }

  const counts = standbyErrorCountsTowardDemotion({
    msSinceSourceSet,
    activeHealthy: state.phase === "playing" || state.phase === "paused",
  })
  if (!counts) return failed
  const standbyErrors = state.standbyErrors + 1
  if (state.playerMode === "one" || !launchDemoted(standbyErrors)) {
    return { ...failed, standbyErrors }
  }
  return {
    ...setSlot(failed, found.player, null),
    standbyErrors,
    playerMode: "one",
    demotedThisLaunch: true,
  }
}

function onTimeout(state: FeedState, token: number): FeedState {
  const slot = state.slots[state.active]
  if (state.phase !== "veiled" || slot?.token !== token) return state
  return {
    ...setSlot(state, state.active, { ...slot, status: "failed" }),
    phase: "clipFailed",
  }
}

function onTap(state: FeedState): FeedState {
  if (state.phase === "playing") {
    return { ...state, phase: "paused", viewerPaused: true }
  }
  if (state.phase === "paused" && state.overlay == null) {
    return {
      ...state,
      phase: "playing",
      viewerPaused: false,
      systemPaused: false,
    }
  }
  return state
}

function onSystemPause(state: FeedState): FeedState {
  if (state.systemPaused) return state
  if (state.phase === "playing") {
    return { ...state, phase: "paused", systemPaused: true }
  }
  if (state.phase === "veiled" || state.phase === "paused") {
    return { ...state, systemPaused: true }
  }
  return state
}

function onOverlayOpen(state: FeedState): FeedState {
  if (state.overlay != null) return state
  if (state.phase === "playing") {
    return { ...state, phase: "paused", overlay: { wasPlaying: true } }
  }
  if (state.phase === "paused") {
    return { ...state, overlay: { wasPlaying: false } }
  }
  if (state.phase === "veiled") {
    const wasPlaying = !state.viewerPaused && !state.systemPaused
    return { ...state, overlay: { wasPlaying } }
  }
  return state
}

function onOverlayClose(state: FeedState): FeedState {
  const overlay = state.overlay
  if (overlay == null) return state
  const next: FeedState = { ...state, overlay: null }
  if (state.phase !== "paused") return next
  const resume = overlay.wasPlaying && !pauseHeld(next)
  return resume ? { ...next, phase: "playing" } : next
}

export function feedReducer(state: FeedState, event: FeedEvent): FeedState {
  switch (event.type) {
    case "focus":
      if (state.phase === "unvisited") {
        return { ...state, phase: "preparing", playerMode: event.playerMode }
      }
      return state.phase === "blurred" ? returnFromBlur(state) : state

    case "blur":
      return leave(state, "tabSwitch", event.positionSeconds)

    case "background":
      return leave(state, "background", event.positionSeconds)

    case "keepWatching":
      return leave(state, "keepWatching", event.positionSeconds)

    case "graceExpired":
      if (state.phase !== "blurred" || state.slots[state.active] == null) {
        return state
      }
      return setSlot(state, state.active, null)

    case "clipQueued":
      return queueClip(state, event.clip)

    case "offline":
      return settleQueueOutcome(state, "offline")

    case "empty":
      return settleQueueOutcome(state, "empty")

    case "retry":
      return state.phase === "offline"
        ? { ...state, phase: "preparing" }
        : state

    case "swipeNext":
      return swipe(state, "forward")

    case "swipePrevious":
      return swipe(state, "backward")

    case "rest":
      return state.pagerAtRest ? state : { ...state, pagerAtRest: true }

    case "loaded":
      return onLoaded(state, event.token)

    case "playing":
      return onPlaying(state, event.token)

    case "error":
      return onError(state, event.token, event.msSinceSourceSet)

    case "timeout":
      return onTimeout(state, event.token)

    case "tap":
      return onTap(state)

    case "systemPause":
      return onSystemPause(state)

    case "overlayOpen":
      return onOverlayOpen(state)

    case "overlayClose":
      return onOverlayClose(state)
  }
}
