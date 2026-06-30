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
import { WATCH_PAGE_RAIL_PADDING_CLASSES } from "@/lib/content-width"
import { WATCH_PLAYER_CHROME_REVEAL_EVENT } from "@/lib/watch-player-chrome-events"
import { WATCH_PLAYER_CONTROLS_SOFT_BACKDROP_BACKGROUND } from "@/lib/watch-production-overlays"

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
    expect(
      overlayAnchor
        .querySelector('[data-testid="hero-chrome-language"] svg')
        ?.getAttribute("class"),
    ).toContain("h-6")
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

describe("HeroPlayerControls — fullscreen button behavior", () => {
  function renderFullscreenFixture(player: MuxPlayerRef = makePlayer()) {
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
      value: player,
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

    const fullscreenButton = overlayAnchor.querySelector(
      '[data-testid="hero-chrome-fullscreen"]',
    ) as HTMLButtonElement

    return { fullscreenButton, overlayAnchor, wrapperEl }
  }

  it("requests fullscreen on the wrapper when the standard API is available", async () => {
    const requestFullscreen = vi.fn(() => Promise.resolve())
    const { fullscreenButton, wrapperEl } = renderFullscreenFixture()
    Object.defineProperty(wrapperEl, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    })

    await act(async () => {
      fullscreenButton.click()
    })

    expect(requestFullscreen).toHaveBeenCalledTimes(1)
  })

  it("does not fall through to video fullscreen when a wrapper API returns void", async () => {
    const videoEl = document.createElement("video") as HTMLVideoElement & {
      webkitEnterFullscreen?: () => void
    }
    const webkitRequestFullscreen = vi.fn(() => undefined)
    const webkitEnterFullscreen = vi.fn()
    Object.defineProperty(videoEl, "webkitEnterFullscreen", {
      configurable: true,
      value: webkitEnterFullscreen,
    })
    const { fullscreenButton, wrapperEl } = renderFullscreenFixture(
      videoEl as unknown as MuxPlayerRef,
    )
    Object.defineProperty(wrapperEl, "webkitRequestFullscreen", {
      configurable: true,
      value: webkitRequestFullscreen,
    })

    await act(async () => {
      fullscreenButton.click()
    })

    expect(webkitRequestFullscreen).toHaveBeenCalledTimes(1)
    expect(webkitEnterFullscreen).not.toHaveBeenCalled()
  })

  it("falls back to native WebKit video fullscreen when wrapper fullscreen is unavailable", async () => {
    const videoEl = document.createElement("video") as HTMLVideoElement & {
      webkitEnterFullscreen?: () => void
    }
    const webkitEnterFullscreen = vi.fn()
    Object.defineProperty(videoEl, "webkitEnterFullscreen", {
      configurable: true,
      value: webkitEnterFullscreen,
    })
    const { fullscreenButton } = renderFullscreenFixture(
      videoEl as unknown as MuxPlayerRef,
    )

    await act(async () => {
      fullscreenButton.click()
    })

    expect(webkitEnterFullscreen).toHaveBeenCalledTimes(1)
  })

  it("exits native WebKit video fullscreen when the video is already fullscreen", async () => {
    const videoEl = document.createElement("video") as HTMLVideoElement & {
      webkitDisplayingFullscreen?: boolean
      webkitEnterFullscreen?: () => void
      webkitExitFullscreen?: () => void
    }
    const webkitEnterFullscreen = vi.fn()
    const webkitExitFullscreen = vi.fn()
    Object.defineProperties(videoEl, {
      webkitDisplayingFullscreen: {
        configurable: true,
        value: true,
      },
      webkitEnterFullscreen: {
        configurable: true,
        value: webkitEnterFullscreen,
      },
      webkitExitFullscreen: {
        configurable: true,
        value: webkitExitFullscreen,
      },
    })
    const { fullscreenButton } = renderFullscreenFixture(
      videoEl as unknown as MuxPlayerRef,
    )

    await act(async () => {
      fullscreenButton.click()
    })

    expect(webkitExitFullscreen).toHaveBeenCalledTimes(1)
    expect(webkitEnterFullscreen).not.toHaveBeenCalled()
  })
})

describe("HeroPlayerControls — chrome layout", () => {
  it("lets the custom chrome span the full portal width", () => {
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

    const chrome = overlayAnchor.querySelector(
      '[data-testid="hero-player-custom-chrome"]',
    )
    const className = chrome?.getAttribute("class") ?? ""
    expect(className).toContain("inset-x-0")
    expect(className).toContain("w-full")
    expect(className).not.toContain("w-3/5")
    for (const railClass of WATCH_PAGE_RAIL_PADDING_CLASSES.split(" ")) {
      expect(className).toContain(railClass)
    }
    expect(
      overlayAnchor
        .querySelector('[data-testid="hero-chrome-timeline"]')
        ?.getAttribute("class"),
    ).toContain("min-w-0")
    for (const testId of [
      "hero-chrome-play",
      "hero-chrome-mute",
      "hero-chrome-fullscreen",
    ]) {
      expect(
        overlayAnchor
          .querySelector(`[data-testid="${testId}"]`)
          ?.getAttribute("class"),
      ).toContain("cursor-pointer")
      expect(
        overlayAnchor
          .querySelector(`[data-testid="${testId}"]`)
          ?.getAttribute("class"),
      ).toContain("bg-transparent")
      expect(
        overlayAnchor
          .querySelector(`[data-testid="${testId}"]`)
          ?.getAttribute("class"),
      ).toContain("h-10")
      expect(
        overlayAnchor
          .querySelector(`[data-testid="${testId}"]`)
          ?.getAttribute("class"),
      ).toContain("w-10")
      expect(
        overlayAnchor
          .querySelector(`[data-testid="${testId}"]`)
          ?.getAttribute("class"),
      ).toContain("md:h-12")
      expect(
        overlayAnchor
          .querySelector(`[data-testid="${testId}"]`)
          ?.getAttribute("class"),
      ).toContain("md:w-12")
      expect(
        overlayAnchor
          .querySelector(`[data-testid="${testId}"]`)
          ?.getAttribute("class"),
      ).toContain("hover:scale-110")
      expect(
        overlayAnchor
          .querySelector(`[data-testid="${testId}"]`)
          ?.getAttribute("class"),
      ).toContain("hover:text-white")
      expect(
        overlayAnchor
          .querySelector(`[data-testid="${testId}"]`)
          ?.getAttribute("class"),
      ).not.toContain("hover:drop-shadow")
      expect(
        overlayAnchor
          .querySelector(`[data-testid="${testId}"]`)
          ?.getAttribute("class"),
      ).toContain("focus-visible:ring-2")
      expect(
        overlayAnchor
          .querySelector(`[data-testid="${testId}"]`)
          ?.getAttribute("class"),
      ).toContain("focus-visible:ring-brand-red/70")
      expect(
        overlayAnchor
          .querySelector(`[data-testid="${testId}"] svg`)
          ?.getAttribute("width"),
      ).toBe("24")
      expect(
        overlayAnchor
          .querySelector(`[data-testid="${testId}"]`)
          ?.getAttribute("class"),
      ).not.toContain("bg-black")
    }
    expect(
      overlayAnchor
        .querySelector('[data-testid="hero-chrome-timeline"]')
        ?.querySelector(".group-hover\\/timeline\\:bg-white\\/30")
        ?.getAttribute("class"),
    ).toContain("group-hover/timeline:bg-white/30")
    expect(
      overlayAnchor
        .querySelector('[data-testid="hero-chrome-volume-slider"]')
        ?.getAttribute("class"),
    ).toContain("hover:bg-white/30")
    const volumeContainer = overlayAnchor.querySelector(
      '[data-testid="hero-chrome-volume-container"]',
    ) as HTMLElement
    const muteButton = overlayAnchor.querySelector(
      '[data-testid="hero-chrome-mute"]',
    ) as HTMLElement
    expect(
      volumeContainer.compareDocumentPosition(muteButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(volumeContainer.getAttribute("class")).toContain("mr-0")
    expect(volumeContainer.getAttribute("class")).not.toContain("ml-0")

    const backdrop = overlayAnchor.querySelector(
      '[data-testid="hero-player-chrome-backdrop"]',
    ) as HTMLDivElement
    expect(backdrop).not.toBeNull()
    expect(backdrop.getAttribute("class")).toContain("h-[28vh]")
    expect(backdrop.getAttribute("class")).toContain("w-screen")
    expect(backdrop.getAttribute("class")).toContain("left-1/2")
    expect(backdrop.getAttribute("class")).toContain("-translate-x-1/2")
    expect(backdrop.getAttribute("class")).not.toContain("inset-x-0")
    expect(backdrop.getAttribute("class")).toContain(
      "[background:var(--watch-player-controls-backdrop)]",
    )
    expect(backdrop.getAttribute("style")).toContain(
      WATCH_PLAYER_CONTROLS_SOFT_BACKDROP_BACKGROUND,
    )
  })
})

describe("HeroPlayerControls — visibility callback", () => {
  it("reports dimmed state, ignores pointer movement for 5s, and wakes dim after later video movement", async () => {
    vi.useFakeTimers()
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
    const onVisibilityChange = vi.fn()

    try {
      act(() => {
        root.render(
          <HeroPlayerControls
            player={playerRef.current}
            playerRef={playerRef as React.RefObject<MuxPlayerRef | null>}
            wrapperRef={wrapperRef as React.RefObject<HTMLDivElement | null>}
            overlayAnchor={overlayAnchor}
            onVisibilityChange={onVisibilityChange}
          />,
        )
      })

      expect(onVisibilityChange).toHaveBeenCalledWith({
        visible: true,
        opacity: 1,
      })
      onVisibilityChange.mockClear()

      await act(async () => {
        window.dispatchEvent(
          new MouseEvent("pointermove", { clientX: 100, clientY: 100 }),
        )
        window.dispatchEvent(
          new MouseEvent("pointermove", { clientX: 124, clientY: 100 }),
        )
      })

      expect(onVisibilityChange).not.toHaveBeenCalledWith({
        visible: true,
        opacity: 1,
      })

      await act(async () => {
        vi.advanceTimersByTime(5001)
      })

      expect(onVisibilityChange).toHaveBeenCalledWith({
        visible: false,
        opacity: 0,
      })

      await act(async () => {
        window.dispatchEvent(
          new MouseEvent("pointermove", { clientX: 100, clientY: 100 }),
        )
      })

      expect(onVisibilityChange).toHaveBeenLastCalledWith({
        visible: true,
        opacity: 1,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("ignores header reveal requests during the 5s lockout and accepts them after", async () => {
    vi.useFakeTimers()
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
    const onVisibilityChange = vi.fn()

    try {
      act(() => {
        root.render(
          <HeroPlayerControls
            player={playerRef.current}
            playerRef={playerRef as React.RefObject<MuxPlayerRef | null>}
            wrapperRef={wrapperRef as React.RefObject<HTMLDivElement | null>}
            overlayAnchor={overlayAnchor}
            onVisibilityChange={onVisibilityChange}
          />,
        )
      })
      onVisibilityChange.mockClear()

      await act(async () => {
        window.dispatchEvent(new Event(WATCH_PLAYER_CHROME_REVEAL_EVENT))
      })

      expect(onVisibilityChange).not.toHaveBeenCalledWith({
        visible: true,
        opacity: 1,
      })

      await act(async () => {
        vi.advanceTimersByTime(5001)
      })

      await act(async () => {
        window.dispatchEvent(new Event(WATCH_PLAYER_CHROME_REVEAL_EVENT))
      })

      expect(onVisibilityChange).toHaveBeenCalledWith({
        visible: true,
        opacity: 1,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
