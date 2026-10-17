/**
 * @vitest-environment jsdom
 *
 * Video section — Mux-only path. The flag-off (video.js) branch was
 * removed once `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION` graduated.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import {
  holdDeferredChunk,
  rejectDeferredChunk,
  resetDeferredChunk,
} from "@/__mocks__/next-dynamic-sync"
import { Video } from "@/components/sections/Video"
import {
  WatchModalActivityProvider,
  useWatchModalActivity,
} from "@/components/watch/WatchModalActivityProvider"
// This section defers `@forge/video-player/mux-video` through `next/dynamic`
// so hls.js and mux-embed stay out of the Watch routes' first-load script set
// (feat-719 / FGE-138). Resolve it synchronously here so the cases below keep
// driving a real <video>. See the mock module for what that erases.
vi.mock("next/dynamic", async () => import("@/__mocks__/next-dynamic-sync"))
// `React.lazy` settles its payload across microtask turns, and the real
// `@mux/mux-video-react` module graph needs more than one. Warming the module
// registry first means the loader's promise is already resolved, so the very
// first `await act(...)` render commits the player instead of suspending.
beforeAll(async () => {
  await import("@forge/video-player/mux-video")
})

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
  resetDeferredChunk()
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

  const posterFragment = {
    ...baseFragment,
    media: { url: "https://image.mux.com/poster-id/thumbnail.jpg" },
  } as Parameters<typeof Video>[0]["data"]

  function posterImage() {
    return container.querySelector(
      '[data-testid="deferred-video-poster"] img',
    ) as HTMLImageElement | null
  }

  // The player is `ssr: false`, so neither the server markup nor a client
  // whose chunk is still in flight has a <video> to carry the poster. The
  // pending stub stands in for both: Next renders the same empty loading slot
  // on the server as it does while the chunk downloads.
  it("paints the poster without the player chunk, server and client", async () => {
    holdDeferredChunk()

    const html = renderToString(<Video data={posterFragment} />)
    expect(html).not.toContain("<video")
    expect(html).toContain("https://image.mux.com/poster-id/thumbnail.jpg")

    await act(async () => {
      root.render(<Video data={posterFragment} />)
    })

    expect(container.querySelector("video")).toBeNull()
    expect(posterImage()?.getAttribute("src")).toBe(
      "https://image.mux.com/poster-id/thumbnail.jpg",
    )
  })

  it("keeps the poster behind the player once the chunk arrives", async () => {
    const release = holdDeferredChunk()
    await act(async () => {
      root.render(<Video data={posterFragment} />)
    })

    await act(async () => {
      release()
    })

    expect(container.querySelector("video")).not.toBeNull()
    expect(posterImage()).not.toBeNull()
  })

  // A rejected chunk never attaches a media element, so no media event can
  // ever end the loading state. Before this, the spinner ran forever over
  // controls whose handlers all null-guard on the missing element.
  it("ends in a finite failure state when the player chunk fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    rejectDeferredChunk()

    await act(async () => {
      root.render(<Video data={posterFragment} />)
    })

    expect(container.querySelector("video")).toBeNull()
    expect(
      container.querySelector('[data-testid="video-player-loading"]'),
    ).toBeNull()
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain("Something went wrong.")
    expect(alert?.querySelector("button")?.textContent).toBe("Try again")
    // Inert controls go with the player; the artwork stays.
    expect(container.querySelector('input[type="range"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Unmute"]')).toBeNull()
    expect(posterImage()).not.toBeNull()
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
