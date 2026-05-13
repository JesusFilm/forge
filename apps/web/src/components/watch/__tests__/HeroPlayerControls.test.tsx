/**
 * @vitest-environment jsdom
 *
 * HeroPlayerControls — fullscreen portal-target swap.
 *
 * The chrome bar (timeline + volume + language + fullscreen buttons) is
 * portaled to `overlayAnchor` by default — a zero-height sibling div that
 * sits AFTER the sticky hero so the chrome rides on the body's top edge.
 * In fullscreen mode the wrapper element is what the browser renders;
 * everything outside it (including overlayAnchor) is hidden. So the
 * portal target swaps to `wrapperRef.current` when fullscreen is active.
 *
 * These tests assert that swap. They are the regression guard for the
 * "chrome disappears in fullscreen" bug.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRef } from "react"
import type { MuxPlayerRef } from "@forge/video-player"

import { HeroPlayerControls } from "@/components/watch/HeroPlayerControls"

let container: HTMLDivElement
let root: Root

function makePlayer(): MuxPlayerRef {
  return {
    muted: false,
    currentTime: 0,
    paused: true,
    duration: 0,
    volume: 1,
    buffered: null,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MuxPlayerRef
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  // Reset jsdom fullscreen state between tests.
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get() {
      return null
    },
  })
  document.body.innerHTML = ""
})

function setFullscreenElement(el: Element | null) {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get() {
      return el
    },
  })
  document.dispatchEvent(new Event("fullscreenchange"))
}

describe("HeroPlayerControls — in-chrome language button render gate", () => {
  function renderWith(props: {
    showLanguageButton?: boolean
    onLanguageClick?: () => void
  }) {
    const wrapperEl = document.createElement("div")
    const overlayAnchor = document.createElement("div")
    document.body.appendChild(wrapperEl)
    document.body.appendChild(overlayAnchor)
    const wrapperRef = createRef<HTMLDivElement>()
    Object.defineProperty(wrapperRef, "current", {
      writable: true,
      value: wrapperEl,
    })
    const playerRef = createRef<MuxPlayerRef | null>()
    Object.defineProperty(playerRef, "current", {
      writable: true,
      value: makePlayer(),
    })
    act(() => {
      root.render(
        <HeroPlayerControls
          player={playerRef.current}
          playerRef={playerRef as React.RefObject<MuxPlayerRef | null>}
          wrapperRef={wrapperRef as React.RefObject<HTMLDivElement | null>}
          overlayAnchor={overlayAnchor}
          showLanguageButton={props.showLanguageButton}
          onLanguageClick={props.onLanguageClick}
        />,
      )
    })
    return overlayAnchor
  }

  it("renders the in-chrome globe when showLanguageButton + onLanguageClick are both provided", () => {
    const overlayAnchor = renderWith({
      showLanguageButton: true,
      onLanguageClick: () => {},
    })
    expect(
      overlayAnchor.querySelector('[data-testid="hero-chrome-language"]'),
    ).not.toBeNull()
  })

  it("does not render the in-chrome globe when showLanguageButton is false", () => {
    const overlayAnchor = renderWith({
      showLanguageButton: false,
      onLanguageClick: () => {},
    })
    expect(
      overlayAnchor.querySelector('[data-testid="hero-chrome-language"]'),
    ).toBeNull()
  })

  it("does not render the in-chrome globe when onLanguageClick is undefined", () => {
    const overlayAnchor = renderWith({ showLanguageButton: true })
    expect(
      overlayAnchor.querySelector('[data-testid="hero-chrome-language"]'),
    ).toBeNull()
  })

  it("fires onLanguageClick exactly once when the in-chrome globe is clicked", async () => {
    const onLanguageClick = vi.fn()
    const overlayAnchor = renderWith({
      showLanguageButton: true,
      onLanguageClick,
    })
    const btn = overlayAnchor.querySelector(
      '[data-testid="hero-chrome-language"]',
    ) as HTMLButtonElement
    expect(btn).not.toBeNull()
    await act(async () => {
      btn.click()
    })
    expect(onLanguageClick).toHaveBeenCalledTimes(1)
  })
})

describe("HeroPlayerControls — portal target swap on fullscreen", () => {
  it("portals chrome into overlayAnchor outside fullscreen", () => {
    const wrapperEl = document.createElement("div")
    const overlayAnchor = document.createElement("div")
    overlayAnchor.dataset.testid = "overlay-anchor-fixture"
    document.body.appendChild(wrapperEl)
    document.body.appendChild(overlayAnchor)
    const wrapperRef = createRef<HTMLDivElement>()
    Object.defineProperty(wrapperRef, "current", {
      writable: true,
      value: wrapperEl,
    })
    const playerRef = createRef<MuxPlayerRef | null>()
    Object.defineProperty(playerRef, "current", {
      writable: true,
      value: makePlayer(),
    })

    act(() => {
      root.render(
        <HeroPlayerControls
          player={playerRef.current}
          playerRef={playerRef as React.RefObject<MuxPlayerRef | null>}
          wrapperRef={wrapperRef as React.RefObject<HTMLDivElement | null>}
          overlayAnchor={overlayAnchor}
        />,
      )
    })

    // Chrome should be inside overlayAnchor, not inside wrapperEl.
    const chromeInOverlay = overlayAnchor.querySelector(
      '[data-testid="hero-player-custom-chrome"]',
    )
    const chromeInWrapper = wrapperEl.querySelector(
      '[data-testid="hero-player-custom-chrome"]',
    )
    expect(chromeInOverlay).not.toBeNull()
    expect(chromeInWrapper).toBeNull()
  })

  it("swaps chrome into wrapperRef when document.fullscreenElement is set", async () => {
    const wrapperEl = document.createElement("div")
    const overlayAnchor = document.createElement("div")
    document.body.appendChild(wrapperEl)
    document.body.appendChild(overlayAnchor)
    const wrapperRef = createRef<HTMLDivElement>()
    Object.defineProperty(wrapperRef, "current", {
      writable: true,
      value: wrapperEl,
    })
    const playerRef = createRef<MuxPlayerRef | null>()
    Object.defineProperty(playerRef, "current", {
      writable: true,
      value: makePlayer(),
    })

    act(() => {
      root.render(
        <HeroPlayerControls
          player={playerRef.current}
          playerRef={playerRef as React.RefObject<MuxPlayerRef | null>}
          wrapperRef={wrapperRef as React.RefObject<HTMLDivElement | null>}
          overlayAnchor={overlayAnchor}
        />,
      )
    })

    // Enter fullscreen on the wrapper element.
    await act(async () => {
      setFullscreenElement(wrapperEl)
    })

    const chromeInOverlay = overlayAnchor.querySelector(
      '[data-testid="hero-player-custom-chrome"]',
    )
    const chromeInWrapper = wrapperEl.querySelector(
      '[data-testid="hero-player-custom-chrome"]',
    )
    // After the swap: chrome lives in wrapper, NOT in overlayAnchor.
    expect(chromeInWrapper).not.toBeNull()
    expect(chromeInOverlay).toBeNull()
  })

  it("swaps chrome back to overlayAnchor when fullscreen exits", async () => {
    const wrapperEl = document.createElement("div")
    const overlayAnchor = document.createElement("div")
    document.body.appendChild(wrapperEl)
    document.body.appendChild(overlayAnchor)
    const wrapperRef = createRef<HTMLDivElement>()
    Object.defineProperty(wrapperRef, "current", {
      writable: true,
      value: wrapperEl,
    })
    const playerRef = createRef<MuxPlayerRef | null>()
    Object.defineProperty(playerRef, "current", {
      writable: true,
      value: makePlayer(),
    })

    act(() => {
      root.render(
        <HeroPlayerControls
          player={playerRef.current}
          playerRef={playerRef as React.RefObject<MuxPlayerRef | null>}
          wrapperRef={wrapperRef as React.RefObject<HTMLDivElement | null>}
          overlayAnchor={overlayAnchor}
        />,
      )
    })

    await act(async () => {
      setFullscreenElement(wrapperEl)
    })
    await act(async () => {
      setFullscreenElement(null)
    })

    const chromeInOverlay = overlayAnchor.querySelector(
      '[data-testid="hero-player-custom-chrome"]',
    )
    const chromeInWrapper = wrapperEl.querySelector(
      '[data-testid="hero-player-custom-chrome"]',
    )
    // Back to default: chrome lives in overlayAnchor.
    expect(chromeInOverlay).not.toBeNull()
    expect(chromeInWrapper).toBeNull()
  })
})
