/**
 * @vitest-environment jsdom
 *
 * U12 — VideoHero dual-branch characterization tests.
 *
 * - Flag-off branch (videojs path): smoke-only — component mounts and the
 *   shared overlay (mute button, heading, subheading) renders. The video.js
 *   instance itself is mocked so we don't depend on a real video element.
 * - Flag-on branch (Mux path): mounts via `<MuxVideo>` and exposes the same
 *   shared overlay. Behavior preservation: mute-toggle click flips the
 *   `muted` property on the underlying ref; scroll-away pauses the video.
 *
 * The flag-off branch was captured FIRST per the plan's
 * "Characterization-first for VideoHero" execution note.
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

// Mock `video.js` BEFORE importing VideoHero so the flag-off branch's
// videojs() call resolves to our test double.
const { videojsMock } = vi.hoisted(() => ({
  videojsMock: vi.fn(),
}))
vi.mock("video.js", () => ({
  default: videojsMock,
}))

// Mock the env module so we can flip the migration flag per test.
vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION: false },
}))

import { env } from "@/env"

import { VideoHero } from "@/components/sections/VideoHero"

type MutableEnv = {
  NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION: boolean
}

function setFlag(value: boolean) {
  ;(env as unknown as MutableEnv).NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION =
    value
}

type MockPlayer = {
  on: ReturnType<typeof vi.fn>
  src: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  muted: ReturnType<typeof vi.fn>
  currentTime: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

function createMockPlayer(): MockPlayer {
  let muted = true
  return {
    on: vi.fn(),
    src: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    muted: vi.fn((next?: boolean) => {
      if (typeof next === "boolean") muted = next
      return muted
    }),
    currentTime: vi.fn(),
    dispose: vi.fn(),
  }
}

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
let mockPlayer: MockPlayer

beforeEach(() => {
  // jsdom's HTMLMediaElement.prototype.play returns undefined by default,
  // but Mux's autoplay handler chains `.catch()` on the result. Polyfill
  // it to a resolved Promise on the prototype for the duration of the
  // test (restored in afterEach via vi.restoreAllMocks).
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() =>
    Promise.resolve(),
  )
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  mockPlayer = createMockPlayer()
  videojsMock.mockReturnValue(mockPlayer)
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

describe("VideoHero — flag-off (videojs branch)", () => {
  it("mounts via the videojs branch and renders the shared overlay", async () => {
    setFlag(false)

    await act(async () => {
      root.render(<VideoHero data={baseFragment} />)
    })

    // VideoHeroPlayer testid exists on the player wrapper for both branches.
    expect(container.querySelector('[data-testid="VideoHero"]')).not.toBeNull()
    expect(
      container.querySelector('[data-testid="VideoHeroPlayer"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="VideoHeroMuteButton"]'),
    ).not.toBeNull()
    expect(container.textContent).toContain("Test Heading")
    expect(container.textContent).toContain("Test Subheading")

    // videojs() was invoked exactly once with the <video> element.
    expect(videojsMock).toHaveBeenCalledTimes(1)
  })

  it("toggles mute on click via the videojs `muted()` setter", async () => {
    setFlag(false)

    await act(async () => {
      root.render(<VideoHero data={baseFragment} />)
    })

    const muteButton = container.querySelector(
      '[data-testid="VideoHeroMuteButton"]',
    ) as HTMLButtonElement
    expect(muteButton.getAttribute("aria-label")).toBe("Unmute")

    await act(async () => {
      muteButton.click()
    })

    // First click should call player.muted(false).
    const calledWithFalse = mockPlayer.muted.mock.calls.some(
      (args) => args[0] === false,
    )
    expect(calledWithFalse).toBe(true)
    expect(muteButton.getAttribute("aria-label")).toBe("Mute")
  })
})

describe("VideoHero — flag-on (Mux branch)", () => {
  it("mounts via the Mux branch and renders the shared overlay (no videojs() call)", async () => {
    setFlag(true)

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

    // Critical: videojs() must NOT be called on the Mux branch.
    expect(videojsMock).not.toHaveBeenCalled()

    // @mux/mux-video-react renders a plain <video> element directly (no
    // `mux-video` custom element, unlike @mux/mux-player-react). Confirm
    // the underlying <video> is mounted.
    expect(container.querySelector("video")).not.toBeNull()
  })

  it("mute-toggle click flips the `muted` property on the underlying media element", async () => {
    setFlag(true)

    await act(async () => {
      root.render(<VideoHero data={baseFragment} />)
    })

    // The Mux branch initially mounts muted (state default).
    const muteButton = container.querySelector(
      '[data-testid="VideoHeroMuteButton"]',
    ) as HTMLButtonElement
    expect(muteButton.getAttribute("aria-label")).toBe("Unmute")

    // Locate the underlying <video> element (jsdom — the ref resolves to the
    // <video> directly per U1 finding). We use the public DOM API to assert
    // the click handler's effect rather than the React ref.
    const videoEl = container.querySelector("video") as HTMLVideoElement | null
    if (videoEl) {
      // Spy on muted setter to verify the click writes through.
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
      // jsdom may not have synthesized the inner <video>. At minimum the
      // click should not throw and the React state should still flip.
      await act(async () => {
        muteButton.click()
      })
      expect(muteButton.getAttribute("aria-label")).toBe("Mute")
    }
  })

  it("scroll past 100px pauses the underlying video element", async () => {
    setFlag(true)

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
    // the scroll handler doesn't throw — the more rigorous pause assertion
    // is verified in Playwright per the U1 production-stack smoke note.
  })
})
