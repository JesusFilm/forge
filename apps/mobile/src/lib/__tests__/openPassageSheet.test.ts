/**
 * The in-app passage sheet, and the pause it owns.
 *
 * The pause is load-bearing on BOTH platforms. Measured 2026-08-27 on an
 * Android 15 emulator: launching a browser over a playing video drops the app
 * into a picture-in-picture window with playback still running, because
 * expo-web-browser never sets FLAG_ACTIVITY_NO_USER_ACTION and expo-video
 * passes `setAutoEnterEnabled` through. Without this pause the viewer reads
 * scripture over their own still-playing video.
 */

type Listener = (state: string) => void

// `mock`-prefixed: jest forbids a module factory from reaching any other
// out-of-scope binding.
const mockOpenBrowserAsync = jest.fn()

jest.mock("expo-web-browser", () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
}))

import { AppState } from "react-native"

import { openPassageSheet } from "../openPassageSheet"
import {
  resetPlaybackTransportForTests,
  setPlaybackTransport,
} from "../playbackInterruption"

// Spy on the real AppState rather than replacing the whole module: jest-expo's
// own setup needs react-native intact.
const mockAppStateListeners: Listener[] = []
const mockRemoveSpy = jest.fn()

jest.spyOn(AppState, "addEventListener").mockImplementation(((
  _event: string,
  listener: Listener,
) => {
  mockAppStateListeners.push(listener)
  return {
    remove: () => {
      mockRemoveSpy()
      const index = mockAppStateListeners.indexOf(listener)
      if (index >= 0) mockAppStateListeners.splice(index, 1)
    },
  }
}) as unknown as typeof AppState.addEventListener)

const PASSAGE_URL = "https://www.bible.com/bible/3034/GEN.1.26-27.BSB"

function fakeTransport(initiallyPlaying: boolean) {
  const state = { playing: initiallyPlaying, pauses: 0, plays: 0 }
  setPlaybackTransport({
    isPlaying: () => state.playing,
    pause: () => {
      state.pauses += 1
      state.playing = false
    },
    play: () => {
      state.plays += 1
      state.playing = true
    },
  })
  return state
}

function emitAppState(state: string) {
  for (const listener of [...mockAppStateListeners]) listener(state)
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAppStateListeners.length = 0
  resetPlaybackTransportForTests()
  mockOpenBrowserAsync.mockResolvedValue({ type: "opened" })
})

describe("openPassageSheet", () => {
  it("pauses a playing video before the browser is presented", async () => {
    const state = fakeTransport(true)
    let pausesAtOpen = -1
    mockOpenBrowserAsync.mockImplementation(async () => {
      pausesAtOpen = state.pauses
      return { type: "opened" }
    })

    void openPassageSheet(PASSAGE_URL)
    await flush()

    expect(pausesAtOpen).toBe(1)
    expect(state.playing).toBe(false)
  })

  // Covers AE13.
  it("leaves a paused video paused after dismissal", async () => {
    const state = fakeTransport(false)

    void openPassageSheet(PASSAGE_URL)
    await flush()
    emitAppState("background")
    emitAppState("active")
    await flush()

    expect(state.pauses).toBe(0)
    expect(state.plays).toBe(0)
    expect(state.playing).toBe(false)
  })

  it("resumes a playing video when the viewer returns", async () => {
    const state = fakeTransport(true)

    void openPassageSheet(PASSAGE_URL)
    await flush()
    expect(state.playing).toBe(false)

    emitAppState("background")
    emitAppState("active")
    await flush()

    expect(state.plays).toBe(1)
    expect(state.playing).toBe(true)
  })

  // Android's `openBrowserAsync` resolves the moment the tab OPENS, not when it
  // closes. Resuming on that promise would un-pause the video behind the sheet.
  it("does not resume when the browser reports only that it opened", async () => {
    const state = fakeTransport(true)

    void openPassageSheet(PASSAGE_URL)
    await flush()

    expect(state.plays).toBe(0)
    expect(state.playing).toBe(false)
  })

  // iOS resolves on dismissal, and reports `inactive` rather than backgrounding.
  it("resumes on an iOS dismissal result", async () => {
    const state = fakeTransport(true)
    mockOpenBrowserAsync.mockResolvedValue({ type: "dismiss" })

    void openPassageSheet(PASSAGE_URL)
    await flush()

    expect(state.plays).toBe(1)
    expect(state.playing).toBe(true)
  })

  it("resumes once, not once per foreground", async () => {
    const state = fakeTransport(true)

    void openPassageSheet(PASSAGE_URL)
    await flush()
    emitAppState("background")
    emitAppState("active")
    emitAppState("background")
    emitAppState("active")
    await flush()

    expect(state.plays).toBe(1)
  })

  it("ignores an `active` report that follows no departure", async () => {
    const state = fakeTransport(true)

    void openPassageSheet(PASSAGE_URL)
    await flush()
    emitAppState("active")
    await flush()

    expect(state.plays).toBe(0)
  })

  // Never strand the viewer on a video this paused.
  it("resumes when the browser fails to present at all", async () => {
    const state = fakeTransport(true)
    mockOpenBrowserAsync.mockRejectedValue(new Error("no browser installed"))

    void openPassageSheet(PASSAGE_URL)
    await flush()

    expect(state.plays).toBe(1)
    expect(state.playing).toBe(true)
  })

  it("releases its lifecycle listener once it is done", async () => {
    fakeTransport(true)

    void openPassageSheet(PASSAGE_URL)
    await flush()
    emitAppState("background")
    emitAppState("active")
    await flush()

    expect(mockRemoveSpy).toHaveBeenCalledTimes(1)
    expect(mockAppStateListeners).toHaveLength(0)
  })

  it("opens nothing for a URL that fails validation", async () => {
    const state = fakeTransport(true)

    await openPassageSheet("javascript:alert(1)")

    expect(mockOpenBrowserAsync).not.toHaveBeenCalled()
    expect(state.pauses).toBe(0)
    expect(state.playing).toBe(true)
  })

  // `validateActionUrl` allows http in a DEVELOPMENT bundle only. A release
  // bundle — what a viewer runs — rejects it.
  it("opens nothing for a plain-http URL in a release bundle", async () => {
    const globals = globalThis as unknown as { __DEV__: boolean }
    const wasDev = globals.__DEV__
    globals.__DEV__ = false
    try {
      const state = fakeTransport(true)

      await openPassageSheet("http://www.bible.com/bible/3034/GEN.1.26-27.BSB")

      expect(mockOpenBrowserAsync).not.toHaveBeenCalled()
      expect(state.pauses).toBe(0)
    } finally {
      globals.__DEV__ = wasDev
    }
  })

  it("survives a host that has not registered a player", async () => {
    resetPlaybackTransportForTests()

    await expect(openPassageSheet(PASSAGE_URL)).resolves.toBeUndefined()
    expect(mockOpenBrowserAsync).toHaveBeenCalledWith(PASSAGE_URL)
  })
})
