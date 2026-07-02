import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { formatTime, useVideoPlayerCore } from "./useVideoPlayerCore"

const { videojsMock } = vi.hoisted(() => ({
  videojsMock: vi.fn(),
}))
const players: MockPlayer[] = []

vi.mock("video.js", () => ({
  default: videojsMock,
}))

type Listener = () => void

type MockTextTrack = {
  kind: string
  language: string
  label: string
  src: string
  mode: "disabled" | "hidden" | "showing"
}

type MockRemoteTextTrackHandle = {
  track: MockTextTrack
}

type MockPlayer = {
  el: () => Element
  ready: (callback: () => void) => void
  src: ReturnType<typeof vi.fn>
  poster: ReturnType<typeof vi.fn>
  addRemoteTextTrack: ReturnType<typeof vi.fn>
  removeRemoteTextTrack: ReturnType<typeof vi.fn>
  textTracks: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  paused: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  muted: ReturnType<typeof vi.fn>
  currentTime: ReturnType<typeof vi.fn>
  duration: ReturnType<typeof vi.fn>
  setCurrentTime: (next: number) => void
  emit: (event: string) => void
}

function createMockPlayer(videoEl?: HTMLVideoElement): MockPlayer {
  const listeners = new Map<string, Set<Listener>>()
  const remoteTracks: MockRemoteTextTrackHandle[] = []
  const playerElement = document.createElement("div")
  let paused = true
  let muted = true
  let currentTime = 0
  const duration = 128

  const emit = (event: string) => {
    for (const listener of listeners.get(event) ?? []) {
      listener()
    }
  }

  const player: MockPlayer = {
    el() {
      return playerElement
    },
    ready(callback) {
      callback()
    },
    src: vi.fn(),
    poster: vi.fn(),
    addRemoteTextTrack: vi.fn((options) => {
      const handle: MockRemoteTextTrackHandle = {
        track: {
          kind: String(options.kind ?? "subtitles"),
          language: String(options.srclang ?? ""),
          label: String(options.label ?? ""),
          src: String(options.src ?? ""),
          mode: options.default ? "showing" : "disabled",
        },
      }
      remoteTracks.push(handle)
      return handle
    }),
    removeRemoteTextTrack: vi.fn((track: MockRemoteTextTrackHandle) => {
      const index = remoteTracks.indexOf(track)
      if (index >= 0) {
        remoteTracks.splice(index, 1)
      }
    }),
    textTracks: vi.fn(() => remoteTracks.map((entry) => entry.track)),
    on: vi.fn((event: string, listener: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(event, set)
    }),
    off: vi.fn((event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener)
    }),
    dispose: vi.fn(() => {
      videoEl?.remove()
    }),
    paused: vi.fn(() => paused),
    play: vi.fn(() => {
      paused = false
      emit("play")
      return Promise.resolve()
    }),
    pause: vi.fn(() => {
      paused = true
      emit("pause")
    }),
    muted: vi.fn((next?: boolean) => {
      if (typeof next === "boolean") {
        muted = next
        emit("volumechange")
      }
      return muted
    }),
    currentTime: vi.fn((next?: number) => {
      if (typeof next === "number") {
        currentTime = next
      }
      return currentTime
    }),
    duration: vi.fn(() => duration),
    setCurrentTime(next: number) {
      currentTime = next
    },
    emit,
  }

  return player
}

function Harness({
  src,
  poster,
  autoplayOnViewport,
  playOnSourceChange,
  nativeControls,
  textTracks,
  videoClassName,
}: {
  src: string
  poster?: string
  autoplayOnViewport?: boolean
  playOnSourceChange?: boolean
  nativeControls?: boolean
  videoClassName?: string
  textTracks?: Array<{
    src: string
    label: string
    languageCode: string
    kind?: "subtitles" | "captions" | "chapters"
    isDefault?: boolean
  }>
}) {
  const {
    containerRef,
    videoRef,
    sliderRef,
    timeRef,
    isMuted,
    isPlaying,
    isFullscreen,
    handlePlayPause,
    handleMuteToggle,
    handleSeek,
    handleFullscreen,
  } = useVideoPlayerCore({
    src,
    poster,
    autoplayOnViewport,
    playOnSourceChange,
    nativeControls,
    textTracks,
  })

  return (
    <div ref={containerRef}>
      <video className={videoClassName} ref={videoRef} />
      <button type="button" aria-label="toggle play" onClick={handlePlayPause}>
        {isPlaying ? "playing" : "paused"}
      </button>
      <button type="button" aria-label="toggle mute" onClick={handleMuteToggle}>
        {isMuted ? "muted" : "unmuted"}
      </button>
      <button
        type="button"
        aria-label="toggle fullscreen"
        onClick={handleFullscreen}
      >
        {isFullscreen ? "fullscreen" : "windowed"}
      </button>
      <button
        type="button"
        aria-label="seek video"
        onClick={() =>
          handleSeek({
            target: { value: "42" },
          } as never)
        }
      >
        seek
      </button>
      <input ref={sliderRef} type="range" onChange={handleSeek} />
      <span ref={timeRef}>0:00 / 0:00</span>
    </div>
  )
}

async function renderHarness(props: Parameters<typeof Harness>[0]) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)

  await act(async () => {
    root.render(<Harness {...props} />)
  })

  return { container, root }
}

let fullscreenElement: Element | null = null
let rafId = 0
let rafCallbacks = new Map<number, FrameRequestCallback>()

function flushAnimationFrame(timestamp = 16) {
  const callbacks = Array.from(rafCallbacks.entries())
  rafCallbacks = new Map()

  for (const [, callback] of callbacks) {
    callback(timestamp)
  }
}

beforeEach(() => {
  videojsMock.mockImplementation((videoEl) => {
    const player = createMockPlayer(videoEl as HTMLVideoElement)
    players.push(player)
    return player
  })

  rafId = 0
  rafCallbacks = new Map()
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const nextId = ++rafId
    rafCallbacks.set(nextId, callback)
    return nextId
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafCallbacks.delete(id)
  })

  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  })
})

afterEach(() => {
  players.length = 0
  videojsMock.mockReset()
  document.body.innerHTML = ""
  fullscreenElement = null
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen")
})

describe("formatTime", () => {
  it("formats minutes and seconds", () => {
    expect(formatTime(0)).toBe("0:00")
    expect(formatTime(65)).toBe("1:05")
    expect(formatTime(600)).toBe("10:00")
  })

  it("formats hour-plus durations as h:mm:ss", () => {
    expect(formatTime(3600)).toBe("1:00:00")
    expect(formatTime(3725)).toBe("1:02:05")
  })
})

describe("useVideoPlayerCore", () => {
  it("reuses the same player instance and updates source in place", async () => {
    const { root } = await renderHarness({
      src: "https://example.com/one.m3u8",
      poster: "https://example.com/poster-one.jpg",
    })

    expect(videojsMock).toHaveBeenCalledTimes(1)
    expect(videojsMock).toHaveBeenCalledWith(
      expect.any(HTMLVideoElement),
      expect.objectContaining({ controls: false }),
    )
    expect(players[0]?.src).toHaveBeenCalledWith({
      type: "application/x-mpegURL",
      src: "https://example.com/one.m3u8",
    })
    expect(players[0]?.poster).toHaveBeenCalledWith(
      "https://example.com/poster-one.jpg",
    )

    await act(async () => {
      root.render(
        <Harness
          src="https://example.com/two.m3u8"
          poster="https://example.com/poster-two.jpg"
        />,
      )
    })

    expect(videojsMock).toHaveBeenCalledTimes(1)
    expect(players[0]?.src).toHaveBeenCalledWith({
      type: "application/x-mpegURL",
      src: "https://example.com/two.m3u8",
    })
    expect(players[0]?.poster).toHaveBeenCalledWith(
      "https://example.com/poster-two.jpg",
    )
    expect(players[0]?.dispose).not.toHaveBeenCalled()

    await act(async () => {
      root.unmount()
    })

    expect(players[0]?.dispose).toHaveBeenCalledTimes(1)
  })

  it("preserves Video.js classes on the player root", async () => {
    await renderHarness({
      src: "https://example.com/one.m3u8",
      videoClassName: "video-js vjs-default-skin jobs-review-video-element",
    })

    expect(players[0]?.el().classList.contains("video-js")).toBe(true)
    expect(players[0]?.el().classList.contains("vjs-default-skin")).toBe(true)
    expect(
      players[0]?.el().classList.contains("jobs-review-video-element"),
    ).toBe(true)
  })

  it("can opt into native Video.js controls without changing the default", async () => {
    const customControls = await renderHarness({
      src: "https://example.com/one.m3u8",
    })

    expect(videojsMock).toHaveBeenCalledWith(
      expect.any(HTMLVideoElement),
      expect.objectContaining({ controls: false }),
    )

    await act(async () => {
      customControls.root.unmount()
    })

    const nativeControls = await renderHarness({
      src: "https://example.com/two.m3u8",
      nativeControls: true,
    })

    expect(videojsMock).toHaveBeenLastCalledWith(
      expect.any(HTMLVideoElement),
      expect.objectContaining({ controls: true }),
    )

    await act(async () => {
      nativeControls.root.unmount()
    })
  })

  it("keeps the video element connected when player options reinitialize", async () => {
    const { root } = await renderHarness({
      src: "https://example.com/one.m3u8",
    })

    await act(async () => {
      root.render(
        <Harness src="https://example.com/one.m3u8" nativeControls={true} />,
      )
    })

    expect(videojsMock).toHaveBeenCalledTimes(2)
    expect(videojsMock.mock.calls[1]?.[0]).toBeInstanceOf(HTMLVideoElement)
    expect(
      (videojsMock.mock.calls[1]?.[0] as HTMLVideoElement | undefined)
        ?.isConnected,
    ).toBe(true)

    await act(async () => {
      root.unmount()
    })
  })

  it("registers and replaces remote text tracks without remounting the player", async () => {
    const { root } = await renderHarness({
      src: "https://example.com/one.m3u8",
      textTracks: [
        {
          src: "https://example.com/subtitles-es.vtt",
          label: "Spanish",
          languageCode: "es",
          isDefault: true,
        },
        {
          src: "https://example.com/chapters.vtt",
          label: "Chapters",
          languageCode: "en",
          kind: "chapters",
          isDefault: true,
        },
      ],
    })

    const player = players[0]
    expect(player?.addRemoteTextTrack).toHaveBeenCalledWith(
      {
        kind: "subtitles",
        src: "https://example.com/subtitles-es.vtt",
        label: "Spanish",
        srclang: "es",
        default: true,
      },
      false,
    )
    expect(player?.addRemoteTextTrack).toHaveBeenCalledWith(
      {
        kind: "chapters",
        src: "https://example.com/chapters.vtt",
        label: "Chapters",
        srclang: "en",
        default: true,
      },
      false,
    )
    expect(player?.textTracks()).toMatchObject([
      { language: "es", mode: "showing" },
      { kind: "chapters", mode: "hidden" },
    ])

    await act(async () => {
      root.render(
        <Harness
          src="https://example.com/one.m3u8"
          textTracks={[
            {
              src: "https://example.com/subtitles-fr.vtt",
              label: "French",
              languageCode: "fr",
              isDefault: true,
            },
          ]}
        />,
      )
    })

    expect(videojsMock).toHaveBeenCalledTimes(1)
    expect(player?.removeRemoteTextTrack).toHaveBeenCalledTimes(2)
    expect(player?.textTracks()).toMatchObject([
      { language: "fr", mode: "showing" },
    ])

    await act(async () => {
      root.render(
        <Harness src="https://example.com/one.m3u8" textTracks={[]} />,
      )
    })

    expect(videojsMock).toHaveBeenCalledTimes(1)
    expect(player?.removeRemoteTextTrack).toHaveBeenCalledTimes(3)
    expect(player?.textTracks()).toEqual([])

    await act(async () => {
      root.unmount()
    })
  })

  it("wires play, mute, seek, fullscreen, and viewport autoplay controls", async () => {
    const { container, root } = await renderHarness({
      src: "https://example.com/one.m3u8",
      autoplayOnViewport: true,
    })

    const player = players[0]
    expect(player).toBeDefined()

    const host = container.firstElementChild as HTMLElement
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
      top: 10,
      bottom: 120,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    await act(async () => {
      window.dispatchEvent(new Event("scroll"))
    })

    expect(player?.play).toHaveBeenCalled()

    const playButton = container.querySelector(
      'button[aria-label="toggle play"]',
    ) as HTMLButtonElement
    const muteButton = container.querySelector(
      'button[aria-label="toggle mute"]',
    ) as HTMLButtonElement
    const fullscreenButton = container.querySelector(
      'button[aria-label="toggle fullscreen"]',
    ) as HTMLButtonElement
    const seekButton = container.querySelector(
      'button[aria-label="seek video"]',
    ) as HTMLButtonElement
    const status = container.querySelector("span") as HTMLSpanElement

    await act(async () => {
      playButton.click()
    })

    expect(player?.pause).toHaveBeenCalled()
    expect(status.textContent).toBe("0:00 / 0:00")

    await act(async () => {
      muteButton.click()
    })

    expect(player?.muted).toHaveBeenCalledWith(false)

    await act(async () => {
      seekButton.click()
    })

    expect(player?.currentTime).toHaveBeenCalledWith(42)

    let fullscreenTarget: Element | null = null
    const requestFullscreen = vi.fn(async () => {
      fullscreenElement = fullscreenTarget
    })
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    })
    fullscreenTarget = fullscreenButton

    await act(async () => {
      fullscreenButton.click()
    })

    expect(requestFullscreen).toHaveBeenCalled()

    await act(async () => {
      root.unmount()
    })
  })

  it("keeps progress and time labels in sync while playback advances", async () => {
    const { container, root } = await renderHarness({
      src: "https://example.com/one.m3u8",
    })

    const player = players[0]
    expect(player).toBeDefined()

    await act(async () => {
      player?.emit("durationchange")
    })

    const slider = container.querySelector(
      'input[type="range"]',
    ) as HTMLInputElement
    const status = container.querySelector("span") as HTMLSpanElement

    expect(slider.value).toBe("0")
    expect(status.textContent).toBe("0:00 / 2:08")

    await act(async () => {
      void player?.play()
    })

    player?.setCurrentTime(42)

    await act(async () => {
      flushAnimationFrame()
    })

    expect(slider.max).toBe("128")
    expect(slider.value).toBe("42")
    expect(status.textContent).toBe("0:42 / 2:08")

    await act(async () => {
      root.unmount()
    })
  })
})
