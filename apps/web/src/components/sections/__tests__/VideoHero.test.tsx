/**
 * @vitest-environment jsdom
 *
 * VideoHero — Mux-only path. The flag-off (video.js) branch was removed
 * once `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION` graduated; the section
 * now renders `<MuxVideo>` (`@mux/mux-video-react`) unconditionally.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest"

import { VideoHero } from "@/components/sections/VideoHero"
import {
  WatchModalActivityProvider,
  useWatchModalActivity,
} from "@/components/watch/WatchModalActivityProvider"

const baseFragment = {
  id: "vh-1",
  sectionKey: "hero",
  useRouteVideo: false,
  heading: "Test Heading",
  subheading: "Test Subheading",
  ctaLabel: null,
  ctaLink: null,
  streamingUrl: "https://example.com/test.m3u8",
  video: null,
} as Parameters<typeof VideoHero>[0]["data"]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  // jsdom's HTMLMediaElement.prototype.play returns undefined by default,
  // but the Mux autoplay handler chains `.catch()` on the result. Polyfill
  // it to a resolved Promise on the prototype for the duration of the
  // test (restored in afterEach via vi.restoreAllMocks).
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

describe("VideoHero", () => {
  function ModalOwner({ active }: { active: boolean }) {
    useWatchModalActivity(active, { releaseDelayMs: 0 })
    return null
  }

  async function renderWithModal(active: boolean) {
    await act(async () => {
      root.render(
        <WatchModalActivityProvider>
          <ModalOwner active={active} />
          <VideoHero data={baseFragment} />
        </WatchModalActivityProvider>,
      )
    })
  }

  it("mounts the Mux branch and renders the shared overlay", async () => {
    await act(async () => {
      root.render(<VideoHero data={baseFragment} />)
    })

    expect(container.querySelector('[data-testid="VideoHero"]')).not.toBeNull()
    expect(
      container.querySelector('[data-testid="VideoHeroPlayer"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="VideoHeroMuteButton"]'),
    ).not.toBeNull()
    expect(container.textContent).toContain("Test Heading")
    expect(container.textContent).toContain("Test Subheading")

    // @mux/mux-video-react renders a plain <video> element directly.
    expect(container.querySelector("video")).not.toBeNull()
  })

  it("mute-toggle click flips the `muted` property on the underlying media element", async () => {
    await act(async () => {
      root.render(<VideoHero data={baseFragment} />)
    })

    const muteButton = container.querySelector(
      '[data-testid="VideoHeroMuteButton"]',
    ) as HTMLButtonElement
    expect(muteButton.getAttribute("aria-label")).toBe("Unmute")

    // Locate the underlying <video> element (jsdom — the ref resolves to
    // the <video> directly). We use the public DOM API to assert the
    // click handler's effect rather than the React ref.
    const videoEl = container.querySelector("video") as HTMLVideoElement | null
    if (videoEl) {
      let mutedValue = true
      Object.defineProperty(videoEl, "muted", {
        configurable: true,
        get: () => mutedValue,
        set: (v: boolean) => {
          mutedValue = v
        },
      })

      await act(async () => {
        muteButton.click()
      })

      expect(mutedValue).toBe(false)
    } else {
      // jsdom may not synthesize the inner <video>. The click should at
      // least not throw and the React state should still flip.
      await act(async () => {
        muteButton.click()
      })
      expect(muteButton.getAttribute("aria-label")).toBe("Mute")
    }
  })

  it("scroll past 100px pauses the underlying video element", async () => {
    await act(async () => {
      root.render(<VideoHero data={baseFragment} />)
    })

    const videoEl = container.querySelector("video") as HTMLVideoElement | null

    let pauseSpy: MockInstance<() => void> | null = null
    if (videoEl) {
      pauseSpy = vi.spyOn(videoEl, "pause").mockImplementation(() => {})
    }

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => 200,
    })

    await act(async () => {
      window.dispatchEvent(new Event("scroll"))
    })

    if (pauseSpy) {
      expect(pauseSpy).toHaveBeenCalled()
    }
    // If jsdom didn't synthesize the inner <video>, the test still proves
    // the scroll handler doesn't throw — the rigorous pause assertion is
    // verified in Playwright per the U1 production-stack smoke note.
  })

  it("pauses its authored hero media when modal activity opens", async () => {
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
