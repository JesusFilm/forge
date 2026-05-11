/**
 * @vitest-environment jsdom
 *
 * U12 — Video section dual-branch tests.
 *
 * - Flag-off: smoke. Component mounts via the videojs hook path.
 * - Flag-on: mounts via `<MuxVideo>`; videojs() never invoked.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { videojsMock } = vi.hoisted(() => ({
  videojsMock: vi.fn(),
}))
vi.mock("video.js", () => ({
  default: videojsMock,
}))

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION: false },
}))

import { env } from "@/env"

import { Video } from "@/components/sections/Video"

type MutableEnv = {
  NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION: boolean
}
function setFlag(value: boolean) {
  ;(env as unknown as MutableEnv).NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION =
    value
}

function createMockPlayer() {
  let muted = true
  return {
    el: () => document.createElement("div"),
    ready: (cb: () => void) => cb(),
    on: vi.fn(),
    off: vi.fn(),
    src: vi.fn(),
    poster: vi.fn(),
    addRemoteTextTrack: vi.fn(),
    removeRemoteTextTrack: vi.fn(),
    textTracks: vi.fn(() => []),
    paused: vi.fn(() => true),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    muted: vi.fn((next?: boolean) => {
      if (typeof next === "boolean") muted = next
      return muted
    }),
    currentTime: vi.fn(() => 0),
    duration: vi.fn(() => 0),
    dispose: vi.fn(),
  }
}

const baseFragment = {
  t: "video",
  sectionKey: "video",
  useRouteVideo: false,
  streamingUrl: "https://example.com/test.m3u8",
  title: undefined,
  subtitle: undefined,
  mediaUrl: undefined,
  videoId: undefined,
} as Parameters<typeof Video>[0]["data"]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() =>
    Promise.resolve(),
  )
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  videojsMock.mockImplementation(() => createMockPlayer())
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  videojsMock.mockReset()
  setFlag(false)
  vi.restoreAllMocks()
})

describe("Video — flag-off (videojs branch)", () => {
  it("mounts via the videojs hook path and exposes the section testid", async () => {
    setFlag(false)

    await act(async () => {
      root.render(<Video data={baseFragment} />)
    })

    expect(
      container.querySelector('[data-testid="VideoSection"]'),
    ).not.toBeNull()
    expect(videojsMock).toHaveBeenCalledTimes(1)
  })

  it("uses the hydrated video stream when a block only stores videoId", async () => {
    setFlag(false)

    await act(async () => {
      root.render(
        <Video
          data={{
            ...baseFragment,
            streamingUrl: undefined,
            videoId: "video-1",
          }}
          videoMap={
            new Map([
              [
                "video-1",
                {
                  id: "video-1",
                  streamingUrl: "https://example.com/from-video-map.m3u8",
                },
              ],
            ])
          }
        />,
      )
    })

    expect(
      container.querySelector('[data-testid="VideoSection"]'),
    ).not.toBeNull()
    expect(videojsMock).toHaveBeenCalledTimes(1)
  })
})

describe("Video — flag-on (Mux branch)", () => {
  it("mounts via Mux, no videojs() call", async () => {
    setFlag(true)

    await act(async () => {
      root.render(<Video data={baseFragment} />)
    })

    expect(
      container.querySelector('[data-testid="VideoSection"]'),
    ).not.toBeNull()
    expect(videojsMock).not.toHaveBeenCalled()
    // @mux/mux-video-react renders a plain <video> element (no custom-element
    // wrapper, unlike @mux/mux-player-react).
    expect(container.querySelector("video")).not.toBeNull()
  })

  it("renders nothing if streamingUrl resolves to null", async () => {
    setFlag(true)

    const emptyFragment = {
      ...baseFragment,
      streamingUrl: undefined,
    } as Parameters<typeof Video>[0]["data"]

    await act(async () => {
      root.render(<Video data={emptyFragment} />)
    })

    expect(container.querySelector('[data-testid="VideoSection"]')).toBeNull()
    expect(videojsMock).not.toHaveBeenCalled()
  })
})
