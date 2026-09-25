import { useEffect, useMemo, useRef } from "react"
import { AppState, Platform } from "react-native"
import {
  useVideoPlayer,
  type PlayingChangeEventPayload,
  type SourceLoadEventPayload,
  type StatusChangeEventPayload,
  type TimeUpdateEventPayload,
  type VideoPlayer,
  type VideoSource,
} from "expo-video"

import {
  activeWantsPlay,
  audiblePlayer,
  standbySlot,
  type FeedEvent,
  type FeedState,
  type PlayerId,
  type PlayerSlot,
} from "../lib/explore/feedState"
import { readOr, safely } from "../lib/explore/playerRead"
import type { ExploreClipFailure } from "../lib/explore/telemetry"
import type { ClipWindow, FeedClip } from "../lib/explore/types"
import { clamp } from "../lib/scrubber"
import { applyQualityConstraint, type QualityTier } from "../lib/streamQuality"
import { cleanStreamUrl, validateStreamingUrl } from "../lib/validateUrl"

/** KTD23's Explore rendition tier: "low" caps every feed stream at 480p. */
export const EXPLORE_QUALITY_TIER: QualityTier = "low"

/** KTD23: the standby loads only once the active clip has this much ahead. */
export const STANDBY_LOAD_AFTER_BUFFERED_SECONDS = 4

/** KTD23: the standby buffers only a start slice. */
export const STANDBY_FORWARD_BUFFER_SECONDS = 3

/** KTD4: the active player's loop check cadence. The standby sends none. */
export const ACTIVE_TIME_UPDATE_INTERVAL_SECONDS = 0.25

/**
 * KTD4: the device probe could not measure whether the Android cache saves
 * bytes on a loop, so it stays off until that measurement. iOS cannot cache
 * HLS at all.
 */
const EXPLORE_ANDROID_USE_CACHING = false

/** KTD4: a first playing tick further than this from the start re-seeks. */
const START_POSITION_TOLERANCE_SECONDS = 1.5

/** KTD4: the one re-seek gets this long to land; a miss after it fails. */
export const START_RESEEK_GRACE_MS = 1_000

/** The active buffer target never drops below this, so playback can start. */
const ACTIVE_MIN_FORWARD_BUFFER_SECONDS = 2

/** Ticks this soon after a loop seek can still show the old position. */
const LOOP_SEEK_SETTLE_MS = 500

/** A loading edge this soon after a seek is the seek's own, not a rebuffer. */
export const SEEK_LOADING_GRACE_MS = 1_000

/** An unplayable URL never reached a decoder, so it must never demote (KTD3). */
const NO_SOURCE_SET_MS = Number.POSITIVE_INFINITY

const PLAYER_IDS: readonly PlayerId[] = ["a", "b"]

export type FeedPlayerFailure = {
  token: number
  clip: FeedClip
  /** A source error, or a second missed start seek (KTD4). */
  kind: Exclude<ExploreClipFailure, "timeout">
  /** The failed player held the active clip, not the standby. */
  active: boolean
  errorMessage: string | null
}

export type FeedPlayersInput = {
  state: FeedState
  /** Receives only `loaded`, `playing`, and `error`. */
  dispatch: (event: FeedEvent) => void
  /** The saved mute choice (`exploreMuted`). */
  muted: boolean
  /** `clipYieldsToRoot(...)`: while true, no clip plays or has sound. */
  yieldsToRoot: boolean
  /** A loop restarts the clip. The evidence recorder rebases on it (KTD9). */
  onLoop?: (token: number) => void
  /** KTD17's stages that only this hook sees. None of them steers playback. */
  onSourceSet?: (token: number) => void
  onSourceLoaded?: (token: number) => void
  /** The playing active clip drops into loading after its start, not at a seek. */
  onRebuffer?: (token: number) => void
  onClipFailed?: (failure: FeedPlayerFailure) => void
}

export type FeedPlayers = {
  /** Fixed for the hook's life. The feed's views never swap players. */
  players: Readonly<Record<PlayerId, VideoPlayer>>
  /** The player the overlay's progress bar reads its time from. */
  activePlayer: VideoPlayer
  /** R12: seeks the active clip, clamped into its window. */
  seekActive: (seconds: number) => void
}

/** The feed source for a clip, or null for a URL the app does not play. */
function feedSourceUrl(clip: FeedClip): string | null {
  const url = cleanStreamUrl(clip.streamUrl)
  if (url == null || !validateStreamingUrl(url)) return null
  return applyQualityConstraint(url, EXPLORE_QUALITY_TIER)
}

/** KTD23: the active buffer reaches the clip end, and no further. */
function activeForwardBufferSeconds(
  currentTime: number,
  window: ClipWindow,
): number {
  return Math.max(
    ACTIVE_MIN_FORWARD_BUFFER_SECONDS,
    Math.ceil(window.endSeconds - currentTime),
  )
}

type StartCheck = "armed" | "reseeked" | "done"

/** What one player holds, beside what the reducer asked of it. */
type Track = {
  /** The URL last handed to the player. Null once cleared or failed. */
  url: string | null
  /** Bumped on every source change, so a stale settle is dropped. */
  seq: number
  /** `url`'s replaceAsync settled: the player holds it now. */
  settled: boolean
  /** `url`'s sourceLoad arrived. */
  sourceLoaded: boolean
  setAtMs: number
  /** The reducer token this source serves (KTD25). */
  token: number | null
  window: ClipWindow | null
  startAtSeconds: number
  /** The start seek ran and `loaded` went out for `token`. */
  ready: boolean
  startCheck: StartCheck
  reseekAtMs: number
  loopSeekAtMs: number
  /** Any seek on this player: the start, a re-seek, a loop, or a scrub. */
  seekAtMs: number
  playRequested: boolean
  interval: number
  forwardBufferSeconds: number | null
}

function newTrack(): Track {
  return {
    url: null,
    seq: 0,
    settled: false,
    sourceLoaded: false,
    setAtMs: 0,
    token: null,
    window: null,
    startAtSeconds: 0,
    ready: false,
    startCheck: "done",
    reseekAtMs: 0,
    loopSeekAtMs: Number.NEGATIVE_INFINITY,
    seekAtMs: Number.NEGATIVE_INFINITY,
    playRequested: false,
    interval: 0,
    forwardBufferSeconds: null,
  }
}

function errorMessageOf(reason: unknown): string | null {
  if (reason instanceof Error) return reason.message
  return typeof reason === "string" ? reason : null
}

function feedVideoSource(url: string): VideoSource {
  return {
    uri: url,
    useCaching: Platform.OS === "android" && EXPLORE_ANDROID_USE_CACHING,
  }
}

/**
 * The URI a sourceLoad names. `null` is the load of a cleared source, which is
 * never a clip's; `undefined` means the payload names no source at all.
 */
function loadedUri(
  payload: SourceLoadEventPayload | undefined,
): string | null | undefined {
  const source: unknown = payload?.videoSource
  if (source === null) return null
  if (typeof source === "string") return source
  if (typeof source === "object") {
    const uri = (source as { uri?: unknown }).uri
    return typeof uri === "string" ? uri : undefined
  }
  return undefined
}

/** The slot a player serves. The standby has none in one-player mode. */
function slotFor(state: FeedState, id: PlayerId): PlayerSlot | null {
  return id === state.active ? state.slots[id] : standbySlot(state)
}

/**
 * The imperative half of the hook. Native events arrive outside React's
 * commit, so the engine reads its inputs from the last commit and keeps its
 * own per-player tracks for the hook's whole life.
 */
function createFeedPlayerEngine() {
  let players: Record<PlayerId, VideoPlayer> | null = null
  let inputs: FeedPlayersInput | null = null
  const tracks: Record<PlayerId, Track> = { a: newTrack(), b: newTrack() }
  /** The active token whose buffer let the standby load (KTD23). */
  let gateOpenFor: number | null = null
  let reconciling = false
  let reconcileAgain = false

  const send = (event: FeedEvent) => inputs?.dispatch(event)

  function attach(next: Record<PlayerId, VideoPlayer>) {
    for (const id of PLAYER_IDS) {
      if (players != null && players[id] !== next[id]) tracks[id] = newTrack()
    }
    players = next
  }

  function setInputs(next: FeedPlayersInput) {
    inputs = next
  }

  function setMuted(id: PlayerId, muted: boolean) {
    const player = players?.[id]
    if (player == null) return
    safely(() => {
      if (player.muted !== muted) player.muted = muted
    })
  }

  function pause(id: PlayerId) {
    const player = players?.[id]
    const track = tracks[id]
    if (player == null) return
    // A play can still be pending while `playing` reads false, so a requested
    // play is paused even when the player does not report playing yet.
    if (track.playRequested || readOr(() => player.playing, false)) {
      safely(() => player.pause())
    }
    track.playRequested = false
  }

  function play(id: PlayerId) {
    const player = players?.[id]
    if (player == null) return
    tracks[id].playRequested = true
    if (!readOr(() => player.playing, true)) safely(() => player.play())
  }

  function seek(id: PlayerId, seconds: number) {
    const player = players?.[id]
    if (player == null) return
    tracks[id].seekAtMs = Date.now()
    safely(() => {
      player.currentTime = seconds
    })
  }

  function setForwardBuffer(id: PlayerId, seconds: number) {
    const player = players?.[id]
    const track = tracks[id]
    if (player == null || track.forwardBufferSeconds === seconds) return
    track.forwardBufferSeconds = seconds
    safely(() => {
      player.bufferOptions = { preferredForwardBufferDuration: seconds }
    })
  }

  /** KTD4 and KTD23: the active clip ticks and buffers; the standby does not. */
  function applyRole(id: PlayerId, active: boolean) {
    const player = players?.[id]
    const track = tracks[id]
    if (player == null) return
    const interval =
      active && track.token != null ? ACTIVE_TIME_UPDATE_INTERVAL_SECONDS : 0
    if (track.interval !== interval) {
      track.interval = interval
      safely(() => {
        player.timeUpdateEventInterval = interval
      })
    }
    if (!active) {
      setForwardBuffer(id, STANDBY_FORWARD_BUFFER_SECONDS)
    } else if (track.window != null) {
      const from = readOr(() => player.currentTime, track.startAtSeconds)
      setForwardBuffer(id, activeForwardBufferSeconds(from, track.window))
    }
  }

  function disableSubtitles(id: PlayerId) {
    const player = players?.[id]
    if (player == null) return
    safely(() => {
      if (player.subtitleTrack != null) player.subtitleTrack = null
    })
  }

  /** Forgets the player's source, so the next bind of any clip reloads. */
  function dropSource(id: PlayerId) {
    const track = tracks[id]
    track.seq += 1
    track.url = null
    track.settled = false
    track.sourceLoaded = false
    track.ready = false
    track.startCheck = "done"
    pause(id)
  }

  /** Reports the bound clip as failed and forgets its source, so a retry reloads. */
  function fail(
    id: PlayerId,
    kind: FeedPlayerFailure["kind"],
    errorMessage: string | null,
    msSinceSourceSet?: number,
  ) {
    const track = tracks[id]
    const token = track.token
    if (token == null) return
    const ms = msSinceSourceSet ?? Date.now() - track.setAtMs
    // Only a failure the reducer applies: the slot still holds this token.
    const slot = inputs == null ? null : slotFor(inputs.state, id)
    if (inputs != null && slot?.token === token) {
      inputs.onClipFailed?.({
        token,
        clip: slot.clip,
        kind,
        active: id === inputs.state.active,
        errorMessage,
      })
    }
    dropSource(id)
    setMuted(id, true)
    send({ type: "error", token, msSinceSourceSet: ms })
  }

  function clearSource(id: PlayerId) {
    const player = players?.[id]
    const track = tracks[id]
    track.token = null
    track.window = null
    dropSource(id)
    if (player == null) return
    safely(() => {
      player.replaceAsync(null).catch(() => {
        // Nothing to report: the source was being released anyway.
      })
    })
  }

  function setSource(id: PlayerId, url: string, active: boolean) {
    const player = players?.[id]
    const track = tracks[id]
    if (player == null) return
    track.seq += 1
    const seq = track.seq
    track.url = url
    track.settled = false
    track.sourceLoaded = false
    track.setAtMs = Date.now()
    // Before the swap: iOS copies the buffer target into the new item.
    setForwardBuffer(
      id,
      active && track.window != null
        ? activeForwardBufferSeconds(track.startAtSeconds, track.window)
        : STANDBY_FORWARD_BUFFER_SECONDS,
    )
    let swap: Promise<void>
    try {
      swap = player.replaceAsync(feedVideoSource(url))
    } catch (error) {
      fail(id, "sourceError", errorMessageOf(error))
      return
    }
    if (track.token != null) inputs?.onSourceSet?.(track.token)
    swap.then(
      () => {
        if (tracks[id].seq === seq) tracks[id].settled = true
      },
      (reason: unknown) => {
        if (tracks[id].seq !== seq) return
        fail(id, "sourceError", errorMessageOf(reason))
        reconcile()
      },
    )
  }

  /** The start seek runs here, on the load, never in the swap's promise. */
  function applyStart(id: PlayerId) {
    const track = tracks[id]
    const token = track.token
    if (token == null) return
    seek(id, track.startAtSeconds)
    track.ready = true
    track.startCheck = "armed"
    send({ type: "loaded", token })
  }

  function bind(track: Track, slot: PlayerSlot) {
    track.token = slot.token
    track.window = slot.clip.window
    track.startAtSeconds = slot.startAtSeconds
    track.ready = false
    track.startCheck = "armed"
    track.reseekAtMs = 0
    track.loopSeekAtMs = Number.NEGATIVE_INFINITY
  }

  function syncSource(id: PlayerId, state: FeedState) {
    const slot = slotFor(state, id)
    const track = tracks[id]
    // KTD13: a null slot is a release.
    if (slot == null) {
      if (track.url != null || track.token != null) clearSource(id)
      return
    }
    if (track.token === slot.token) return
    // KTD25: a streak loads only where the pager stops. KTD13: none while away.
    if (!state.pagerAtRest || state.phase === "blurred") return
    const active = id === state.active
    // KTD23: the standby waits until the active clip is well buffered.
    if (!active && gateOpenFor !== state.slots[state.active]?.token) return

    bind(track, slot)
    const url = feedSourceUrl(slot.clip)
    if (url == null) {
      fail(id, "sourceError", null, NO_SOURCE_SET_MS)
      return
    }
    if (url === track.url) {
      // The player already holds this stream: a replay seeks, with no reload.
      if (track.sourceLoaded) applyStart(id)
      return
    }
    setSource(id, url, active)
  }

  function decide(id: PlayerId, state: FeedState, input: FeedPlayersInput) {
    const slot = slotFor(state, id)
    const track = tracks[id]
    const bound = slot != null && track.token === slot.token && track.ready
    const plays =
      id === state.active &&
      bound &&
      activeWantsPlay(state) &&
      !input.yieldsToRoot &&
      AppState.currentState !== "background"
    const sounds = plays && audiblePlayer(state) === id && !input.muted
    return { plays, sounds }
  }

  function reconcileOnce() {
    const input = inputs
    if (input == null || players == null) return
    const { state } = input
    // KTD2: silence first, so two players never have sound at the same time.
    for (const id of PLAYER_IDS) {
      const { plays, sounds } = decide(id, state, input)
      if (!sounds) setMuted(id, true)
      if (!plays) pause(id)
    }
    for (const id of PLAYER_IDS) {
      syncSource(id, state)
      applyRole(id, id === state.active)
    }
    for (const id of PLAYER_IDS) {
      const { plays, sounds } = decide(id, state, input)
      if (plays) play(id)
      if (sounds) setMuted(id, false)
    }
  }

  function reconcile() {
    // A native event can land while a pass runs; it asks for one more pass.
    if (reconciling) {
      reconcileAgain = true
      return
    }
    reconciling = true
    try {
      do {
        reconcileAgain = false
        reconcileOnce()
      } while (reconcileAgain)
    } finally {
      reconciling = false
    }
  }

  function loop(id: PlayerId) {
    const track = tracks[id]
    if (track.window == null || track.token == null) return
    track.loopSeekAtMs = Date.now()
    seek(id, track.window.startSeconds)
    inputs?.onLoop?.(track.token)
  }

  /** KTD4: one re-seek for a missed start, and a second miss fails the clip. */
  function checkStart(id: PlayerId, position: number) {
    const track = tracks[id]
    if (track.startCheck === "done" || !track.ready) return
    const offset = Math.abs(position - track.startAtSeconds)
    if (offset <= START_POSITION_TOLERANCE_SECONDS) {
      track.startCheck = "done"
      return
    }
    if (track.startCheck === "armed") {
      track.startCheck = "reseeked"
      track.reseekAtMs = Date.now()
      seek(id, track.startAtSeconds)
      return
    }
    if (Date.now() - track.reseekAtMs < START_RESEEK_GRACE_MS) return
    fail(id, "missedSeek", null)
  }

  function onSourceLoad(id: PlayerId, payload?: SourceLoadEventPayload) {
    const track = tracks[id]
    if (track.url == null || track.sourceLoaded) return
    // KTD25: the load of a source that is no longer current never seeks. A
    // load that names no source is taken as ours, or the clip would strand.
    const uri = loadedUri(payload)
    if (uri !== undefined && uri !== track.url) return
    track.sourceLoaded = true
    disableSubtitles(id)
    if (track.token != null) inputs?.onSourceLoaded?.(track.token)
    if (track.token != null && !track.ready) applyStart(id)
    reconcile()
  }

  function onPlayingChange(id: PlayerId, payload?: PlayingChangeEventPayload) {
    if (payload?.isPlaying !== true || players == null) return
    const track = tracks[id]
    if (track.token == null || !track.ready) return
    const player = players[id]
    checkStart(
      id,
      readOr(() => player.currentTime, track.startAtSeconds),
    )
    if (track.ready) send({ type: "playing", token: track.token })
  }

  function onTimeUpdate(id: PlayerId, payload?: TimeUpdateEventPayload) {
    const track = tracks[id]
    const state = inputs?.state
    if (payload == null || players == null || state == null) return
    if (id !== state.active || !track.ready || track.window == null) return
    const token = track.token
    if (token == null) return
    const player = players[id]
    const { currentTime, bufferedPosition } = payload
    const playing = readOr(() => player.playing, false)
    if (playing) checkStart(id, currentTime)
    if (!track.ready || track.startCheck === "reseeked") return

    if (currentTime >= track.window.endSeconds) {
      if (Date.now() - track.loopSeekAtMs >= LOOP_SEEK_SETTLE_MS) loop(id)
      return
    }
    setForwardBuffer(id, activeForwardBufferSeconds(currentTime, track.window))
    const buffered =
      bufferedPosition - currentTime >= STANDBY_LOAD_AFTER_BUFFERED_SECONDS ||
      bufferedPosition >= track.window.endSeconds
    if (playing && buffered && gateOpenFor !== token) {
      gateOpenFor = token
      reconcile()
    }
  }

  function onPlayToEnd(id: PlayerId) {
    const state = inputs?.state
    if (state == null || id !== state.active || !tracks[id].ready) return
    loop(id)
    reconcile()
  }

  /** Only a clip asked to play can rebuffer, so the standby never does. */
  function noteLoading(id: PlayerId) {
    const track = tracks[id]
    const token = track.token
    if (token == null || !track.playRequested) return
    // A first frame that is still loading is a slow start, not a rebuffer.
    if (track.startCheck !== "done") return
    if (Date.now() - track.seekAtMs < SEEK_LOADING_GRACE_MS) return
    inputs?.onRebuffer?.(token)
  }

  function onStatusChange(id: PlayerId, payload?: StatusChangeEventPayload) {
    if (payload?.status === "loading") {
      noteLoading(id)
      return
    }
    if (payload?.status !== "error") return
    const track = tracks[id]
    // Until the new source is set, an error belongs to the outgoing item.
    if (track.url == null || !track.settled || track.token == null) return
    fail(id, "sourceError", payload.error?.message ?? null)
    reconcile()
  }

  function seekActive(seconds: number) {
    const state = inputs?.state
    if (state == null) return
    const id = state.active
    const track = tracks[id]
    if (!track.ready || track.window == null) return
    const { startSeconds, endSeconds } = track.window
    track.startCheck = "done"
    seek(id, clamp(seconds, startSeconds, endSeconds))
  }

  /** The unmount half: no sound and no motion from a player nobody shows. */
  function silence() {
    for (const id of PLAYER_IDS) {
      pause(id)
      setMuted(id, true)
    }
  }

  return {
    attach,
    setInputs,
    reconcile,
    silence,
    seekActive,
    onSourceLoad,
    onPlayingChange,
    onTimeUpdate,
    onPlayToEnd,
    onStatusChange,
    disableSubtitles,
  }
}

type FeedPlayerEngine = ReturnType<typeof createFeedPlayerEngine>

function configure(player: VideoPlayer) {
  // Sound comes only from the reconcile pass, and only for one player.
  player.muted = true
  // KTD4: a loop is a seek in the time listener; native loop re-inits HLS.
  player.loop = false
  // Android's native default is false, which shifts pitch with speed.
  player.preservesPitch = true
  player.allowsExternalPlayback = false
  player.timeUpdateEventInterval = 0
}

/**
 * Explore's two feed-owned players (KTD2), the named exception to the one-player
 * rule: they follow the reducer and never reach the root host or its session.
 * Mount only after first focus (R46). No request starts before a slot.
 */
export function useFeedPlayers(input: FeedPlayersInput): FeedPlayers {
  // KTD2: two long-lived players, each with a frozen null source. A changing
  // source argument would make the hook release and re-create the player.
  const playerA = useVideoPlayer(null, configure)
  const playerB = useVideoPlayer(null, configure)
  const players = useMemo(
    () => ({ a: playerA, b: playerB }),
    [playerA, playerB],
  )

  const engineRef = useRef<FeedPlayerEngine | null>(null)
  if (engineRef.current == null) engineRef.current = createFeedPlayerEngine()
  const engine = engineRef.current

  useEffect(() => {
    engine.attach(players)
    const subscriptions = PLAYER_IDS.flatMap((id) => {
      const player = players[id]
      return [
        player.addListener("sourceLoad", (payload) =>
          engine.onSourceLoad(id, payload),
        ),
        player.addListener("playingChange", (payload) =>
          engine.onPlayingChange(id, payload),
        ),
        player.addListener("timeUpdate", (payload) =>
          engine.onTimeUpdate(id, payload),
        ),
        player.addListener("playToEnd", () => engine.onPlayToEnd(id)),
        player.addListener("statusChange", (payload) =>
          engine.onStatusChange(id, payload),
        ),
        // Captions come from the clip's VTT, so Mux's own track stays off.
        player.addListener("availableSubtitleTracksChange", () =>
          engine.disableSubtitles(id),
        ),
        player.addListener("subtitleTrackChange", () =>
          engine.disableSubtitles(id),
        ),
      ]
    })
    // The cleanup only silences. StrictMode's second setup re-reads the
    // tracks, which the cleanup leaves as they were, so nothing loads twice.
    return () => {
      for (const subscription of subscriptions) {
        safely(() => subscription.remove())
      }
      engine.silence()
    }
  }, [engine, players])

  useEffect(() => {
    engine.setInputs(input)
    engine.reconcile()
  })

  return {
    players,
    activePlayer: players[input.state.active],
    seekActive: engine.seekActive,
  }
}
