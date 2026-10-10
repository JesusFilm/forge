/**
 * @vitest-environment jsdom
 *
 * Video section — Mux-only path. The flag-off (video.js) branch was
 * removed once `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION` graduated.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Video } from "@/components/sections/Video"
import {
  WatchModalActivityProvider,
  useWatchModalActivity,
} from "@/components/watch/WatchModalActivityProvider"

const baseFragment = {
  id: "v-1",
  sectionKey: "video",
  useRouteVideo: false,
  streamingUrl: "https://example.com/test.m3u8",
  title: null,
  subtitle: null,
  media: null,
  videoRef: null,
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
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  vi.restoreAllMocks()
})

describe("Video", () => {
  function ModalOwner({ active }: { active: boolean }) {
    useWatchModalActivity(active, { releaseDelayMs: 0 })
    return null
  }

  async function renderWithModal(active: boolean) {
    await act(async () => {
      root.render(
        <WatchModalActivityProvider>
          <ModalOwner active={active} />
          <Video data={baseFragment} />
        </WatchModalActivityProvider>,
      )
    })
  }

  it("mounts via Mux and exposes the section testid", async () => {
    await act(async () => {
      root.render(<Video data={baseFragment} />)
    })

    expect(
      container.querySelector('[data-testid="VideoSection"]'),
    ).not.toBeNull()
    // @mux/mux-video-react renders a plain <video> element.
    expect(container.querySelector("video")).not.toBeNull()
  })

  it("shows the branded player loader until the media can play", async () => {
    await act(async () => {
      root.render(<Video data={baseFragment} />)
    })

    const video = container.querySelector("video")!
    expect(
      container.querySelector('[data-testid="video-player-loading"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="video-player-loading"]')
        ?.className,
    ).toContain("z-40")
    expect(
      container.querySelector('[data-testid="watch-player-loading-indicator"]'),
    ).not.toBeNull()

    await act(async () => {
      video.dispatchEvent(new Event("canplay"))
    })

    expect(
      container.querySelector('[data-testid="video-player-loading"]'),
    ).toBeNull()
  })

  it("restores the player loader while playback buffers", async () => {
    await act(async () => {
      root.render(<Video data={baseFragment} />)
    })

    const video = container.querySelector("video")!
    await act(async () => {
      video.dispatchEvent(new Event("playing"))
    })
    expect(
      container.querySelector('[data-testid="video-player-loading"]'),
    ).toBeNull()

    await act(async () => {
      video.dispatchEvent(new Event("waiting"))
    })

    expect(
      container.querySelector('[data-testid="video-player-loading"]'),
    ).not.toBeNull()
  })

  it("renders nothing if streamingUrl resolves to null", async () => {
    const emptyFragment = {
      ...baseFragment,
      streamingUrl: null,
    } as Parameters<typeof Video>[0]["data"]

    await act(async () => {
      root.render(<Video data={emptyFragment} />)
    })

    expect(container.querySelector('[data-testid="VideoSection"]')).toBeNull()
  })

  it("pauses its authored media when modal activity opens", async () => {
    await renderWithModal(false)
    const video = container.querySelector("video") as HTMLVideoElement
    Object.defineProperty(video, "paused", {
      configurable: true,
      value: false,
      writable: true,
    })
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {
      Object.defineProperty(video, "paused", {
        configurable: true,
        value: true,
      })
    })

    await renderWithModal(true)

    expect(pause).toHaveBeenCalledOnce()
  })
})
