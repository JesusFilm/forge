/**
 * One expo-video test double for every suite that mounts a player (mini-player
 * window, full player, picture-in-picture), so they cannot drift into three
 * different fake-player contracts. Wire it from a jest.mock factory:
 *
 *   jest.mock("expo-video", () =>
 *     require("../../../test-utils/expoVideoMock").createExpoVideoMock(),
 *   )
 *
 * Then drive it through the module handle:
 *
 *   const video = jest.requireMock("expo-video") as ExpoVideoMock
 *   video.__player.__emit("statusChange", { status: "error" })
 *   video.__settleReplace()
 */

import type {
  BufferOptions,
  SubtitleTrack,
  VideoPlayerStatus,
  VideoSource,
} from "expo-video"

export type FakeListener = (payload?: unknown) => void
export type FakeSubscription = { remove: () => void }

export type FakePlayer = {
  muted: boolean
  loop: boolean
  volume: number
  playing: boolean
  playbackRate: number
  currentTime: number
  duration: number
  status: VideoPlayerStatus
  bufferOptions: BufferOptions
  subtitleTrack: SubtitleTrack | null
  play: jest.Mock
  pause: jest.Mock
  replay: jest.Mock
  seekBy: jest.Mock
  replace: jest.Mock
  replaceAsync: jest.Mock
  addListener: (name: string, fn: FakeListener) => FakeSubscription
  /** Fires a native event at the listeners registered for it. */
  __emit: (name: string, payload?: unknown) => void
  /** Settles the oldest in-flight replaceAsync; rejects it when given a reason. */
  __settleReplace: (reason?: unknown) => void
  __pendingReplaceCount: () => number
  __reset: () => void
}

export type ExpoVideoMock = {
  VideoView: jest.Mock
  useVideoPlayer: jest.Mock
  isPictureInPictureSupported: jest.Mock
  /** The single player every useVideoPlayer call returns (R10: one decoder). */
  __player: FakePlayer
  __settleReplace: (reason?: unknown) => void
  __reset: () => void
}

/**
 * A standalone fake player carrying the surface the adapter and its consumers
 * touch. Playback state is real state (play() flips `playing` and emits
 * playingChange) so a suite reads the same signals the app does.
 */
export function makeFakePlayer(): FakePlayer {
  const listeners = new Map<string, Set<FakeListener>>()
  const pendingReplaces: Array<(reason?: unknown) => void> = []

  const player: FakePlayer = {
    muted: false,
    loop: false,
    volume: 1,
    playing: false,
    playbackRate: 1,
    currentTime: 0,
    duration: 0,
    status: "idle",
    bufferOptions: {},
    subtitleTrack: null,
    play: jest.fn(() => {
      player.playing = true
      player.__emit("playingChange", { isPlaying: true })
    }),
    pause: jest.fn(() => {
      player.playing = false
      player.__emit("playingChange", { isPlaying: false })
    }),
    replay: jest.fn(() => {
      player.currentTime = 0
      player.playing = true
    }),
    seekBy: jest.fn((seconds: number) => {
      player.currentTime += seconds
    }),
    replace: jest.fn((_source: VideoSource) => {
      player.currentTime = 0
    }),
    replaceAsync: jest.fn(
      (_source: VideoSource) =>
        new Promise<void>((resolve, reject) => {
          pendingReplaces.push((reason) => {
            if (reason !== undefined) {
              reject(reason)
              return
            }
            // expo-video 57: the incoming item loads at zero.
            player.currentTime = 0
            resolve()
          })
        }),
    ),
    addListener: (name, fn) => {
      let set = listeners.get(name)
      if (set == null) {
        set = new Set()
        listeners.set(name, set)
      }
      set.add(fn)
      return { remove: () => set.delete(fn) }
    },
    __emit: (name, payload) => {
      for (const fn of [...(listeners.get(name) ?? [])]) fn(payload)
    },
    __settleReplace: (reason) => {
      const settle = pendingReplaces.shift()
      if (settle == null) throw new Error("no in-flight replaceAsync to settle")
      settle(reason)
    },
    __pendingReplaceCount: () => pendingReplaces.length,
    __reset: () => {
      listeners.clear()
      pendingReplaces.length = 0
      player.muted = false
      player.loop = false
      player.volume = 1
      player.playing = false
      player.playbackRate = 1
      player.currentTime = 0
      player.duration = 0
      player.status = "idle"
      player.bufferOptions = {}
      player.subtitleTrack = null
      for (const fn of [
        player.play,
        player.pause,
        player.replay,
        player.seekBy,
        player.replace,
        player.replaceAsync,
      ])
        fn.mockClear()
    },
  }
  return player
}

/** The module body for `jest.mock("expo-video", …)`. */
export function createExpoVideoMock(): ExpoVideoMock {
  const player = makeFakePlayer()
  // Setup runs once per player, as the real hook does — a per-render re-run
  // would let a suite's setup-call count pass for the wrong reason.
  let setupRan = false

  const mock: ExpoVideoMock = {
    VideoView: jest.fn(() => null),
    useVideoPlayer: jest.fn(
      (_source: VideoSource, setup?: (p: FakePlayer) => void) => {
        if (!setupRan) {
          setupRan = true
          setup?.(player)
        }
        return player
      },
    ),
    isPictureInPictureSupported: jest.fn(() => true),
    __player: player,
    __settleReplace: (reason) => player.__settleReplace(reason),
    __reset: () => {
      player.__reset()
      setupRan = false
      mock.VideoView.mockClear()
      mock.useVideoPlayer.mockClear()
      mock.isPictureInPictureSupported.mockClear()
    },
  }
  return mock
}
