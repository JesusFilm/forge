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
  /**
   * Settles the oldest in-flight replaceAsync; rejects it when given a reason.
   *
   * `withholdLoad` resolves the swap WITHOUT the sourceLoad that normally
   * follows — the device state where a source is SET but never loads. Nothing
   * else can produce it, so any wait-for-load timeout is untestable without it.
   */
  __settleReplace: (
    reason?: unknown,
    options?: { withholdLoad?: boolean },
  ) => void
  __pendingReplaceCount: () => number
  __reset: () => void
}

export type ExpoVideoMock = {
  VideoView: jest.Mock
  useVideoPlayer: jest.Mock
  isPictureInPictureSupported: jest.Mock
  /** The single player every useVideoPlayer call returns (R10: one decoder). */
  __player: FakePlayer
  __settleReplace: (
    reason?: unknown,
    options?: { withholdLoad?: boolean },
  ) => void
  __reset: () => void
}

/**
 * A standalone fake player carrying the surface the adapter and its consumers
 * touch. Playback state is real state (play() flips `playing` and emits
 * playingChange) so a suite reads the same signals the app does.
 */
type MockImpl = ReturnType<jest.Mock["getMockImplementation"]>

export function makeFakePlayer(): FakePlayer {
  const listeners = new Map<string, Set<FakeListener>>()
  const pendingReplaces: Array<
    (reason?: unknown, withholdLoad?: boolean) => void
  > = []
  // mockClear() keeps an implementation a case installed with
  // mockImplementation, so a `play` made to throw would still throw in every
  // later case in the file. Captured below and restored by __reset.
  const defaultImpls = new Map<jest.Mock, MockImpl>()

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
    replace: jest.fn((source: VideoSource) => {
      player.currentTime = 0
      // The synchronous path lands the item immediately, so its load event
      // fires here rather than a tick later. The payload names the source that
      // loaded, as the native event does — a consumer that must not act on
      // someone else's load has to be able to tell.
      player.__emit("sourceLoad", { videoSource: source })
    }),
    replaceAsync: jest.fn(
      (source: VideoSource) =>
        new Promise<void>((resolve, reject) => {
          pendingReplaces.push((reason, withholdLoad) => {
            if (reason !== undefined) {
              reject(reason)
              return
            }
            // A source that is SET but never loads: the swap settles and no
            // sourceLoad ever arrives.
            if (withholdLoad === true) {
              resolve()
              return
            }
            // Resolve BEFORE the item lands, because that is the real order:
            // replaceAsync settles while the source is still being applied, so
            // the zero and the sourceLoad arrive a tick later. A seek written
            // in the promise continuation is therefore CLOBBERED here, exactly
            // as it is on a device — see
            // docs/solutions/integration-issues/expo-video-replaceasync-seek-silently-dropped-tvos.md
            resolve()
            void Promise.resolve().then(() => {
              player.currentTime = 0
              player.__emit("sourceLoad", { videoSource: source })
            })
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
    __settleReplace: (reason, options) => {
      const settle = pendingReplaces.shift()
      if (settle == null) throw new Error("no in-flight replaceAsync to settle")
      settle(reason, options?.withholdLoad === true)
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
      ]) {
        fn.mockReset()
        const impl = defaultImpls.get(fn)
        if (impl != null) fn.mockImplementation(impl)
      }
    },
  }

  for (const fn of [
    player.play,
    player.pause,
    player.replay,
    player.seekBy,
    player.replace,
    player.replaceAsync,
  ])
    defaultImpls.set(fn, fn.getMockImplementation())

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
    __settleReplace: (reason, options) =>
      player.__settleReplace(reason, options),
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
