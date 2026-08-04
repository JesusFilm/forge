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

function makePlayer(overrides: Partial<MuxPlayerRef> = {}): MuxPlayerRef {
  const listeners = new Map<string, Set<EventListener>>()
  return {
    muted: false,
    currentTime: 0,
    paused: true,
    duration: 0,
    volume: 1,
    buffered: null,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      const set = listeners.get(type) ?? new Set<EventListener>()
      set.add(listener)
      listeners.set(type, set)
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener)
    }),
    dispatchEvent: vi.fn((event: Event) => {
      listeners.get(event.type)?.forEach((listener) => listener(event))
      return true
    }),
    ...overrides,
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
  window.localStorage.clear()
  // Reset jsdom fullscreen state between tests.
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get() {
      return null
    },
  })
  document.body.innerHTML = ""
})

function renderControlsFixture(player: MuxPlayerRef = makePlayer()) {
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

  return { overlayAnchor, player, playerRef, wrapperEl }
}

function setFullscreenElement(el: Element | null) {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get() {
      return el
    },
  })
  document.dispatchEvent(new Event("fullscreenchange"))
}

describe("HeroPlayerControls — in-chrome language controls", () => {
  function renderWith(props: {
    showLanguageButton?: boolean
    showSubtitleButton?: boolean
    onLanguageClick?: () => void
    languageCode?: string | null
    subtitleLanguageCode?: string | null
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
          showSubtitleButton={props.showSubtitleButton}
          onLanguageClick={props.onLanguageClick}
          languageCode={props.languageCode}
          subtitleLanguageCode={props.subtitleLanguageCode}
        />,
      )
    })
    return overlayAnchor
  }

  it("renders the in-chrome voice icon and audio language code", () => {
    const overlayAnchor = renderWith({
      showLanguageButton: true,
      onLanguageClick: () => {},
      languageCode: "EN",
    })
    const audioButton = overlayAnchor.querySelector(
      '[data-testid="hero-chrome-language"]',
    )
    expect(audioButton).not.toBeNull()
    expect(audioButton?.querySelector(".lucide-audio-lines")).not.toBeNull()
    expect(audioButton?.querySelector(".lucide-globe")).toBeNull()
    expect(
      audioButton?.querySelector('[data-testid="hero-chrome-language-code"]')
        ?.textContent,
    ).toBe("EN")
    expect(audioButton?.querySelector("svg")?.getAttribute("class")).toContain(
      "h-6",
    )
  })

  it("does not render the in-chrome audio control when showLanguageButton is false", () => {
    const overlayAnchor = renderWith({
      showLanguageButton: false,
      onLanguageClick: () => {},
    })
    expect(
      overlayAnchor.querySelector('[data-testid="hero-chrome-language"]'),
    ).toBeNull()
  })

  it("does not render the in-chrome audio control when onLanguageClick is undefined", () => {
    const overlayAnchor = renderWith({ showLanguageButton: true })
    expect(
      overlayAnchor.querySelector('[data-testid="hero-chrome-language"]'),
    ).toBeNull()
  })

  it("fires onLanguageClick exactly once when the in-chrome audio control is clicked", async () => {
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

  it("renders subtitles independently of the multi-audio control gate", () => {
    const overlayAnchor = renderWith({
      showLanguageButton: false,
      showSubtitleButton: true,
      onLanguageClick: () => {},
    })
    expect(
      overlayAnchor.querySelector('[data-testid="hero-chrome-language"]'),
    ).toBeNull()
    expect(
      overlayAnchor.querySelector('[data-testid="hero-chrome-subtitles"]'),
    ).not.toBeNull()
  })

  it("keeps audio, subtitles, and fullscreen in one non-breaking cluster", () => {
    const overlayAnchor = renderWith({
      showLanguageButton: true,
      showSubtitleButton: true,
      onLanguageClick: () => {},
      languageCode: "EN",
      subtitleLanguageCode: "ES",
    })
    const cluster = overlayAnchor.querySelector(
      '[data-testid="hero-chrome-language-controls"]',
    )
    expect(cluster?.className).toContain("shrink-0")
    expect(
      cluster?.contains(
        overlayAnchor.querySelector('[data-testid="hero-chrome-language"]'),
      ),
    ).toBe(true)
    expect(
      cluster?.contains(
        overlayAnchor.querySelector('[data-testid="hero-chrome-subtitles"]'),
      ),
    ).toBe(true)
    expect(
      cluster?.contains(
        overlayAnchor.querySelector('[data-testid="hero-chrome-fullscreen"]'),
      ),
    ).toBe(true)
  })

  it("starts the right-aligned control group at mute", () => {
    const overlayAnchor = renderWith({
      showLanguageButton: true,
      showSubtitleButton: true,
      onLanguageClick: () => {},
      languageCode: "EN",
      subtitleLanguageCode: "ES",
    })
    const muteControls = overlayAnchor.querySelector(
      '[data-testid="hero-chrome-mute"]',
    )?.parentElement
    const time = overlayAnchor.querySelector('[data-testid="hero-chrome-time"]')
    const languageControls = overlayAnchor.querySelector(
      '[data-testid="hero-chrome-language-controls"]',
    )
    expect(muteControls?.className).toContain("ml-auto")
    expect(muteControls?.previousElementSibling).toBe(time)
    expect(muteControls?.nextElementSibling).toBe(languageControls)
  })

  it("uses the compact mobile chrome spacing needed for a single control row", () => {
    const overlayAnchor = renderWith({
      showLanguageButton: true,
      showSubtitleButton: true,
      onLanguageClick: () => {},
      languageCode: "EN",
      subtitleLanguageCode: "ES",
    })
    const chrome = overlayAnchor.querySelector(
      '[data-testid="hero-player-custom-chrome"]',
    )
    const cluster = overlayAnchor.querySelector(
      '[data-testid="hero-chrome-language-controls"]',
    )
    const timeVariants = overlayAnchor.querySelectorAll(
      '[data-testid="hero-chrome-time"] span',
    )
    expect(chrome?.className).toContain("gap-x-1")
    expect(cluster?.className).toContain("gap-1")
    expect(
      overlayAnchor
        .querySelector('[data-testid="hero-chrome-language"] svg')
        ?.getAttribute("class"),
    ).toContain("h-5")
    expect(timeVariants).toHaveLength(2)
    expect(timeVariants[0]?.className).toContain("md:hidden")
    expect(timeVariants[1]?.className).toContain("hidden md:inline")
  })

  it("shows the subtitle code only when it differs from audio", () => {
    const overlayAnchor = renderWith({
      showLanguageButton: true,
      showSubtitleButton: true,
      onLanguageClick: () => {},
      languageCode: "EN",
      subtitleLanguageCode: "ES",
    })
    expect(
      overlayAnchor.querySelector(
        '[data-testid="hero-chrome-subtitle-language-code"]',
      )?.textContent,
    ).toBe("ES")

    act(() => {
      root.render(<></>)
    })
    const matchingAnchor = renderWith({
      showLanguageButton: true,
      showSubtitleButton: true,
      onLanguageClick: () => {},
      languageCode: "EN",
      subtitleLanguageCode: "EN",
    })
    expect(
      matchingAnchor.querySelector(
        '[data-testid="hero-chrome-subtitle-language-code"]',
      ),
    ).toBeNull()
  })

  it("opens the combined modal from the subtitles control", async () => {
    const onLanguageClick = vi.fn()
    const overlayAnchor = renderWith({
      showSubtitleButton: true,
      onLanguageClick,
    })
    const button = overlayAnchor.querySelector(
      '[data-testid="hero-chrome-subtitles"]',
    ) as HTMLButtonElement
    await act(async () => {
      button.click()
    })
    expect(onLanguageClick).toHaveBeenCalledTimes(1)
  })
})

describe("HeroPlayerControls — volume preference", () => {
  const storageKey = "forge.watch.volumePreference"

  it("applies stored volume and mute state on mount", () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ muted: true, volume: 0.25 }),
    )
    const player = makePlayer({ muted: false, volume: 1 })

    const { overlayAnchor } = renderControlsFixture(player)

    expect(player.muted).toBe(true)
    expect(player.volume).toBe(0.25)
    expect(
      overlayAnchor
        .querySelector('[data-testid="hero-chrome-volume-slider"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("0")
  })

  it("ignores corrupt stored volume preference", () => {
    window.localStorage.setItem(storageKey, "{")
    const player = makePlayer({ muted: false, volume: 0.8 })

    renderControlsFixture(player)

    expect(player.muted).toBe(false)
    expect(player.volume).toBe(0.8)
  })

  it("persists mute button changes for the next controls instance", async () => {
    const firstPlayer = makePlayer({ muted: false, volume: 0.7 })
    const { overlayAnchor } = renderControlsFixture(firstPlayer)
    const muteButton = overlayAnchor.querySelector(
      '[data-testid="hero-chrome-mute"]',
    ) as HTMLButtonElement

    await act(async () => {
      muteButton.click()
    })

    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "")).toEqual({
      muted: true,
      volume: 0.7,
    })

    act(() => {
      root.render(<></>)
    })
    const nextPlayer = makePlayer({ muted: false, volume: 1 })
    renderControlsFixture(nextPlayer)

    expect(nextPlayer.muted).toBe(true)
    expect(nextPlayer.volume).toBe(0.7)
  })

  it("persists keyboard volume changes", async () => {
    const player = makePlayer({ muted: false, volume: 0.5 })
    const { overlayAnchor } = renderControlsFixture(player)
    const slider = overlayAnchor.querySelector(
      '[data-testid="hero-chrome-volume-slider"]',
    ) as HTMLDivElement

    await act(async () => {
      slider.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          bubbles: true,
        }),
      )
    })

    expect(player.volume).toBeCloseTo(0.55, 5)
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "")).toEqual({
      muted: false,
      volume: 0.55,
    })
  })

  it("reapplies stored volume after loadedmetadata resets the same media element", async () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ muted: false, volume: 0.25 }),
    )
    const setItemSpy = vi.spyOn(window.localStorage.__proto__, "setItem")
    const player = makePlayer({ muted: true, volume: 1 })

    renderControlsFixture(player)
    expect(player.muted).toBe(false)
    expect(player.volume).toBe(0.25)

    player.muted = true
    player.volume = 1

    await act(async () => {
      player.dispatchEvent(new Event("loadedmetadata"))
      player.dispatchEvent(new Event("loadedmetadata"))
      player.dispatchEvent(new Event("loadedmetadata"))
    })

    expect(player.muted).toBe(false)
    expect(player.volume).toBe(0.25)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "")).toEqual({
      muted: false,
      volume: 0.25,
    })
  })

  it("preserves stored volume when the browser ignores programmatic volume restore", async () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ muted: false, volume: 0.25 }),
    )
    const player = makePlayer({ muted: true })
    let volumeValue = 1
    const dispatchVolumeChange = () => {
      player.dispatchEvent(new Event("volumechange"))
    }
    Object.defineProperty(player, "volume", {
      configurable: true,
      get: () => volumeValue,
      set: vi.fn(() => {
        volumeValue = 1
        dispatchVolumeChange()
      }),
    })
    let mutedValue = true
    Object.defineProperty(player, "muted", {
      configurable: true,
      get: () => mutedValue,
      set: vi.fn((next: boolean) => {
        mutedValue = next
        dispatchVolumeChange()
      }),
    })

    renderControlsFixture(player)

    expect(player.muted).toBe(false)
    expect(player.volume).toBe(1)
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "")).toEqual({
      muted: false,
      volume: 0.25,
    })
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
  it("formats hour-plus playback time as h:mm:ss", () => {
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
      value: makePlayer({
        currentTime: 3725,
        duration: 7674,
      }),
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

    const timeVariants = overlayAnchor.querySelectorAll(
      '[data-testid="hero-chrome-time"] span',
    )
    expect(timeVariants[0]?.textContent).toBe("1:02:05/2:07:54")
    expect(timeVariants[1]?.textContent).toBe("1:02:05 / 2:07:54")
    expect(
      overlayAnchor
        .querySelector('[data-testid="hero-chrome-timeline"]')
        ?.getAttribute("aria-valuetext"),
    ).toContain("1:02:05")
  })

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
