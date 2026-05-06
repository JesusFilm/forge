/**
 * @vitest-environment jsdom
 *
 * U5 — HeroPlayer tests.
 *
 * The Mux Player is mocked at the module boundary so we can:
 *   - Capture the props passed to `<MuxPlayer>` (Mux Data wiring, chrome-hide
 *     CSS variables, playback id).
 *   - Stub the ref with a controllable shape so the iOS-safe click sequence
 *     is observable (synchronous `.muted` / `.currentTime` assignments
 *     followed by `.play()` returning a Promise).
 *
 * These tests do not assert anything that requires real Mux Player chrome
 * (which jsdom cannot render — see U1 spike comment block); the
 * Playwright production-stack smoke owns chrome reveal verification.
 */

import { act, useImperativeHandle } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type MuxPlayerCapturedProps = Record<string, unknown> & {
  ref?: React.Ref<unknown>
  onLoadedMetadata?: (event: Event) => void
  onCanPlay?: (event: Event) => void
  onError?: (event: Event & { detail?: { code?: string } }) => void
}

const { muxPlayerMock, mockPlayerRef } = vi.hoisted(() => {
  type MockPlayer = {
    muted: boolean
    currentTime: number
    paused: boolean
    duration: number
    volume: number
    loop: boolean
    buffered: TimeRanges | null
    play: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
    addEventListener: ReturnType<typeof vi.fn>
    removeEventListener: ReturnType<typeof vi.fn>
  }

  // Singleton ref proxy — tests reset its fields in `beforeEach`.
  const mockPlayerRef: { current: MockPlayer | null } = { current: null }
  function makePlayer(): MockPlayer {
    return {
      muted: true,
      currentTime: 0,
      paused: false,
      duration: 60,
      volume: 1,
      loop: true,
      buffered: null,
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
  }

  const muxPlayerMock = vi.fn((props: MuxPlayerCapturedProps) => {
    const { ref } = props
    // Install the singleton on the ref the consumer passed.
    mockPlayerRef.current ??= makePlayer()
    // Mirror React's ref-installation behavior so the consumer sees the
    // mock player on `playerRef.current` after mount.
    useImperativeHandle(ref as React.RefObject<unknown>, () => {
      return mockPlayerRef.current
    })
    return null
  })

  return { muxPlayerMock, mockPlayerRef }
})

vi.mock("@forge/video-player", () => ({
  MuxPlayer: muxPlayerMock,
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}))

import { HeroPlayer } from "@/components/watch/HeroPlayer"
import type { WatchHeroPlayerBlock } from "@/lib/content"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  muxPlayerMock.mockClear()
  mockPlayerRef.current = null
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function makeBlock(): WatchHeroPlayerBlock {
  return {
    kind: "HeroPlayer",
    video: {
      documentId: "video-1",
      slug: "jesus",
      title: "Jesus",
    } as never,
    variant: {
      documentId: "variant-1",
      slug: "english",
      published: true,
      hls: "https://cdn.example/jesus.m3u8",
      muxVideo: { playbackId: "playback-id-123" },
      language: {
        coreId: "529",
        bcp47: "en",
        slug: "english",
        name: "English",
      },
    } as never,
  }
}

function lastMuxProps(): MuxPlayerCapturedProps {
  const calls = muxPlayerMock.mock.calls
  return calls[calls.length - 1]?.[0] as MuxPlayerCapturedProps
}

// Helpers for firing the captured event handlers — the mock doesn't render
// a real Mux Player so the consumer-side `onCanPlay` / `onError` paths are
// otherwise unobservable.
async function fireCanPlay() {
  const handler = lastMuxProps()?.onCanPlay
  await act(async () => {
    handler?.(new Event("canplay"))
  })
}

async function fireError(code: string) {
  const handler = lastMuxProps()?.onError
  const evt = new Event("error") as Event & { detail?: { code?: string } }
  evt.detail = { code }
  await act(async () => {
    handler?.(evt)
  })
}

describe("HeroPlayer — initial mount", () => {
  it("mounts MuxPlayer with playbackId, autoplay-muted, loop, and chrome-hide CSS variables", () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    const props = lastMuxProps()
    expect(props).toBeDefined()
    expect(props.playbackId).toBe("playback-id-123")
    expect(props.autoPlay).toBe("muted")
    expect(props.muted).toBe(true)
    expect(props.loop).toBe(true)
    const style = props.style as Record<string, string | undefined>
    expect(style?.["--controls"]).toBe("none")
    expect(style?.["--top-controls"]).toBe("none")
    expect(style?.["--center-controls"]).toBe("none")
    expect(style?.["--bottom-controls"]).toBe("none")
  })

  it("wires Mux Data metadata: player_name, video_title, viewer_user_id; disableCookies=true", () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    const props = lastMuxProps()
    expect(props.disableCookies).toBe(true)
    const metadata = props.metadata as Record<string, unknown>
    expect(metadata?.player_name).toBe("forge-web-watch")
    expect(metadata?.video_title).toBe("Jesus")
    // viewer_user_id may be `""` on SSR; in jsdom it's a UUID.
    expect(typeof metadata?.viewer_user_id).toBe("string")
  })

  it("renders a 'Play with Sound' pill (default state) above the player", () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    const pill = container.querySelector(
      '[data-testid="hero-player-unmute-pill"]',
    )
    expect(pill).not.toBeNull()
    expect(pill?.getAttribute("data-state")).toBe("play-with-sound")
    expect(pill?.textContent).toContain("Play with Sound")
  })
})

describe("HeroPlayer — iOS-safe click sequence (AE1)", () => {
  it("synchronously assigns muted=false then calls play() inside the click task — leaves currentTime alone so the muted-loop preview continues seamlessly", async () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    // Snapshot pre-click state.
    expect(mockPlayerRef.current?.muted).toBe(true)
    expect(mockPlayerRef.current?.play).not.toHaveBeenCalled()

    const pill = container.querySelector(
      '[data-testid="hero-player-unmute-pill"]',
    ) as HTMLButtonElement
    expect(pill).not.toBeNull()

    // Order check: capture the order in which mutations & play() happen
    // synchronously within the click handler — BEFORE awaiting the promise.
    const events: string[] = []
    if (mockPlayerRef.current) {
      const player = mockPlayerRef.current
      let muted = player.muted
      let currentTime = player.currentTime
      Object.defineProperty(player, "muted", {
        get: () => muted,
        set: (v: boolean) => {
          muted = v
          events.push("muted=" + String(v))
        },
        configurable: true,
      })
      Object.defineProperty(player, "currentTime", {
        get: () => currentTime,
        set: (v: number) => {
          currentTime = v
          events.push("currentTime=" + String(v))
        },
        configurable: true,
      })
      const originalPlay = player.play
      player.play = vi.fn(() => {
        events.push("play()")
        return originalPlay()
      })
    }

    // Dispatch the click event synchronously (no await between dispatch and
    // assertion) — proves play() is called inside the same task as the
    // click event, which is the iOS user-activation requirement.
    await act(async () => {
      pill.click()
    })

    expect(events).toEqual(["muted=false", "play()"])
    expect(mockPlayerRef.current?.play).toHaveBeenCalledTimes(1)
  })

  it("on play() success: reveals custom chrome (data-chrome-revealed=true), disables loop, and keeps Mux chrome hidden", async () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    const pill = container.querySelector(
      '[data-testid="hero-player-unmute-pill"]',
    ) as HTMLButtonElement

    await act(async () => {
      pill.click()
    })

    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    ) as HTMLElement
    expect(wrapper.getAttribute("data-chrome-revealed")).toBe("true")

    // The unmute pill is gone, replaced by our custom chrome.
    expect(
      container.querySelector('[data-testid="hero-player-unmute-pill"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="hero-player-custom-chrome"]'),
    ).not.toBeNull()

    // Re-rendered MuxPlayer should now have `loop=false`, but Mux's native
    // chrome stays hidden — we render our own React-based chrome on top.
    const props = lastMuxProps()
    expect(props.loop).toBe(false)
    const style = (props.style as Record<string, string | undefined>) ?? {}
    expect(style?.["--controls"]).toBe("none")
  })

  it("on play() rejection (iOS NotAllowedError): pill switches to 'Tap to Unmute' (visually distinct)", async () => {
    // Override the mocked play() to reject, simulating iOS unmute-with-no-gesture.
    mockPlayerRef.current = {
      muted: true,
      currentTime: 0,
      paused: false,
      duration: 60,
      volume: 1,
      loop: true,
      buffered: null,
      play: vi.fn(() => Promise.reject(new Error("NotAllowedError"))),
      pause: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as never

    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    const pillBefore = container.querySelector(
      '[data-testid="hero-player-unmute-pill"]',
    ) as HTMLButtonElement
    expect(pillBefore.getAttribute("data-state")).toBe("play-with-sound")

    await act(async () => {
      pillBefore.click()
    })

    const pillAfter = container.querySelector(
      '[data-testid="hero-player-unmute-pill"]',
    )
    expect(pillAfter).not.toBeNull()
    expect(pillAfter?.getAttribute("data-state")).toBe("tap-to-unmute")
    expect(pillAfter?.textContent).toContain("Tap to Unmute")
  })
})

describe("HeroPlayer — loading spinner lifecycle", () => {
  it("renders the spinner overlay on mount", () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).not.toBeNull()
  })

  it("removes the spinner once onCanPlay fires", async () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })
    await fireCanPlay()
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).toBeNull()
  })

  it("removes the spinner on a non-autoplay-blocked error so Mux's own error UI is visible", async () => {
    // F1 verification: a network/decode/manifest error never fires onCanPlay,
    // so without this fallback the spinner sits over a black box forever.
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).not.toBeNull()
    await fireError("manifest-load-error")
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).toBeNull()
  })

  it("keeps the spinner up when the error is autoplay-blocked (recovery path is the unmute pill, not the player UI)", async () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })
    await fireError("autoplay-blocked")
    // Spinner stays only until onCanPlay fires (which it will once the muted
    // loop buffers). The autoplay-blocked branch must NOT pre-emptively hide
    // it, because that would expose Mux's empty player while we're still
    // showing the unmute pill.
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).not.toBeNull()
  })
})

describe("HeroPlayer — fallback HLS source", () => {
  it("uses src={variant.hls} fallback when playbackId is absent", () => {
    const block = makeBlock()
    block.variant = {
      ...block.variant,
      muxVideo: null,
    } as never

    act(() => {
      root.render(<HeroPlayer block={block} />)
    })

    const props = lastMuxProps()
    expect(props.playbackId).toBeUndefined()
    expect(props.src).toBe("https://cdn.example/jesus.m3u8")
  })
})

// ---------------------------------------------------------------------------
// Custom chrome (HeroPlayerControls) — added in the chrome-revamp work.
// Helpers + suite cover render, button wiring, timeline keyboard seek,
// volume slider mute/unmute heuristics, and the auto-hide timer lifecycle.
// ---------------------------------------------------------------------------

async function revealChrome(): Promise<void> {
  act(() => {
    root.render(<HeroPlayer block={makeBlock()} />)
  })
  const pill = container.querySelector(
    '[data-testid="hero-player-unmute-pill"]',
  ) as HTMLButtonElement
  await act(async () => {
    pill.click()
  })
}

describe("HeroPlayer — custom chrome render", () => {
  it("renders the full chrome element set after Play with Sound", async () => {
    await revealChrome()
    expect(
      container.querySelector('[data-testid="hero-player-custom-chrome"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="hero-player-click-surface"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="hero-chrome-play"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="hero-chrome-mute"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="hero-chrome-fullscreen"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="hero-chrome-timeline"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="hero-chrome-volume-slider"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="hero-chrome-time"]'),
    ).not.toBeNull()
  })

  it("removes the unmute pill once chrome is revealed", async () => {
    await revealChrome()
    expect(
      container.querySelector('[data-testid="hero-player-unmute-pill"]'),
    ).toBeNull()
  })
})

describe("HeroPlayer — chrome button interactions", () => {
  it("play button calls pause() when player is currently playing", async () => {
    await revealChrome()
    if (mockPlayerRef.current) mockPlayerRef.current.paused = false
    mockPlayerRef.current?.pause.mockClear()
    const playBtn = container.querySelector(
      '[data-testid="hero-chrome-play"]',
    ) as HTMLButtonElement
    await act(async () => {
      playBtn.click()
    })
    expect(mockPlayerRef.current?.pause).toHaveBeenCalled()
  })

  it("click-surface toggles play state when paused", async () => {
    await revealChrome()
    if (mockPlayerRef.current) mockPlayerRef.current.paused = true
    mockPlayerRef.current?.play.mockClear()
    const surface = container.querySelector(
      '[data-testid="hero-player-click-surface"]',
    ) as HTMLButtonElement
    await act(async () => {
      surface.click()
    })
    expect(mockPlayerRef.current?.play).toHaveBeenCalled()
  })

  it("mute button toggles player.muted", async () => {
    await revealChrome()
    if (mockPlayerRef.current) mockPlayerRef.current.muted = false
    const muteBtn = container.querySelector(
      '[data-testid="hero-chrome-mute"]',
    ) as HTMLButtonElement
    await act(async () => {
      muteBtn.click()
    })
    expect(mockPlayerRef.current?.muted).toBe(true)
  })

  it("mute button at volume=0 bumps volume to 0.5 on unmute", async () => {
    await revealChrome()
    if (mockPlayerRef.current) {
      mockPlayerRef.current.muted = true
      mockPlayerRef.current.volume = 0
    }
    const muteBtn = container.querySelector(
      '[data-testid="hero-chrome-mute"]',
    ) as HTMLButtonElement
    await act(async () => {
      muteBtn.click()
    })
    expect(mockPlayerRef.current?.volume).toBe(0.5)
    expect(mockPlayerRef.current?.muted).toBe(false)
  })
})

describe("HeroPlayer — timeline keyboard seek", () => {
  it("ArrowRight seeks +5s; +Shift seeks +10s; clamps at duration", async () => {
    await revealChrome()
    if (mockPlayerRef.current) {
      mockPlayerRef.current.currentTime = 10
      mockPlayerRef.current.duration = 60
    }
    const tl = container.querySelector(
      '[data-testid="hero-chrome-timeline"]',
    ) as HTMLDivElement
    await act(async () => {
      tl.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      )
    })
    expect(mockPlayerRef.current?.currentTime).toBe(15)
    await act(async () => {
      tl.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          shiftKey: true,
          bubbles: true,
        }),
      )
    })
    expect(mockPlayerRef.current?.currentTime).toBe(25)
    if (mockPlayerRef.current) mockPlayerRef.current.currentTime = 58
    await act(async () => {
      tl.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          shiftKey: true,
          bubbles: true,
        }),
      )
    })
    expect(mockPlayerRef.current?.currentTime).toBe(60)
  })

  it("ArrowLeft seeks -5s and clamps at 0", async () => {
    await revealChrome()
    if (mockPlayerRef.current) mockPlayerRef.current.currentTime = 3
    const tl = container.querySelector(
      '[data-testid="hero-chrome-timeline"]',
    ) as HTMLDivElement
    await act(async () => {
      tl.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      )
    })
    expect(mockPlayerRef.current?.currentTime).toBe(0)
  })

  it("Home jumps to 0; End jumps to duration", async () => {
    await revealChrome()
    if (mockPlayerRef.current) {
      mockPlayerRef.current.currentTime = 30
      mockPlayerRef.current.duration = 60
    }
    const tl = container.querySelector(
      '[data-testid="hero-chrome-timeline"]',
    ) as HTMLDivElement
    await act(async () => {
      tl.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      )
    })
    expect(mockPlayerRef.current?.currentTime).toBe(0)
    await act(async () => {
      tl.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      )
    })
    expect(mockPlayerRef.current?.currentTime).toBe(60)
  })

  it("PageUp/PageDown seek by 30s", async () => {
    await revealChrome()
    if (mockPlayerRef.current) {
      mockPlayerRef.current.currentTime = 30
      mockPlayerRef.current.duration = 120
    }
    const tl = container.querySelector(
      '[data-testid="hero-chrome-timeline"]',
    ) as HTMLDivElement
    await act(async () => {
      tl.dispatchEvent(
        new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }),
      )
    })
    expect(mockPlayerRef.current?.currentTime).toBe(60)
    await act(async () => {
      tl.dispatchEvent(
        new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }),
      )
    })
    expect(mockPlayerRef.current?.currentTime).toBe(30)
  })

  it.todo(
    "ignores arrow keys when duration is 0 (still preventDefaults) — needs mock listener-invocation upgrade so React state syncs to mock changes",
  )
})

describe("HeroPlayer — volume slider keyboard", () => {
  it("ArrowUp raises volume by 0.05; +Shift raises by 0.10", async () => {
    await revealChrome()
    if (mockPlayerRef.current) {
      mockPlayerRef.current.muted = false
      mockPlayerRef.current.volume = 0.5
    }
    const slider = container.querySelector(
      '[data-testid="hero-chrome-volume-slider"]',
    ) as HTMLDivElement
    await act(async () => {
      slider.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      )
    })
    expect(mockPlayerRef.current?.volume).toBeCloseTo(0.55, 5)
    await act(async () => {
      slider.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          shiftKey: true,
          bubbles: true,
        }),
      )
    })
    expect(mockPlayerRef.current?.volume).toBeCloseTo(0.65, 5)
  })

  it("ArrowDown clamps at 0 and auto-mutes", async () => {
    await revealChrome()
    if (mockPlayerRef.current) {
      mockPlayerRef.current.muted = false
      mockPlayerRef.current.volume = 0.03
    }
    const slider = container.querySelector(
      '[data-testid="hero-chrome-volume-slider"]',
    ) as HTMLDivElement
    await act(async () => {
      slider.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      )
    })
    expect(mockPlayerRef.current?.volume).toBe(0)
    expect(mockPlayerRef.current?.muted).toBe(true)
  })

  it("Raising volume from muted state auto-unmutes", async () => {
    await revealChrome()
    if (mockPlayerRef.current) {
      mockPlayerRef.current.muted = true
      mockPlayerRef.current.volume = 0
    }
    const slider = container.querySelector(
      '[data-testid="hero-chrome-volume-slider"]',
    ) as HTMLDivElement
    await act(async () => {
      slider.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      )
    })
    expect(mockPlayerRef.current?.muted).toBe(false)
    expect(mockPlayerRef.current?.volume).toBeCloseTo(0.05, 5)
  })
})

describe("HeroPlayer — auto-hide timer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("auto-hides chrome 3s after reveal while playing", async () => {
    await revealChrome()
    if (mockPlayerRef.current) mockPlayerRef.current.paused = false
    const chrome = container.querySelector(
      '[data-testid="hero-player-custom-chrome"]',
    ) as HTMLElement
    expect(chrome.getAttribute("data-visible")).toBe("true")
    await act(async () => {
      vi.advanceTimersByTime(3001)
    })
    expect(chrome.getAttribute("data-visible")).toBe("false")
  })

  it.todo(
    "does not auto-hide while paused — needs mock listener-invocation upgrade so React state syncs to mock changes",
  )
})

// ---------------------------------------------------------------------------
// Sticky-hero / portal layout (the scroll-over-hero refactor).
// These tests cover what the visual refactor introduced: the chrome bar
// gets portaled into the overlay anchor (not the sticky wrapper), the
// tap-to-unmute branch leaves currentTime alone, and the sticky `top`
// inline style is computed from the measured wrapper height.
// ---------------------------------------------------------------------------

describe("HeroPlayer — sticky-hero / portal layout", () => {
  it("portals the chrome bar into the overlay anchor, not the sticky hero wrapper", async () => {
    await revealChrome()
    const chrome = container.querySelector(
      '[data-testid="hero-player-custom-chrome"]',
    )
    const anchor = container.querySelector(
      '[data-testid="hero-player-overlay-anchor"]',
    )
    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    )
    expect(chrome).not.toBeNull()
    expect(anchor).not.toBeNull()
    expect(wrapper).not.toBeNull()
    // Portal target — chrome bar lives under the zero-height anchor that
    // scrolls with the body section, not under the sticky hero wrapper.
    expect(anchor!.contains(chrome!)).toBe(true)
    expect(wrapper!.contains(chrome!)).toBe(false)
  })

  it("tap-to-unmute branch calls play() without resetting currentTime", async () => {
    // mockPlayerRef.current is null until the muxPlayerMock factory runs
    // during render — so we have to render first, then swap play() to
    // reject (driving the pill into 'tap-to-unmute' state on click 1).
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })
    if (mockPlayerRef.current) {
      mockPlayerRef.current.play = vi.fn(() =>
        Promise.reject(new Error("NotAllowedError")),
      )
    }

    const pillFirst = container.querySelector(
      '[data-testid="hero-player-unmute-pill"]',
    ) as HTMLButtonElement
    await act(async () => {
      pillFirst.click()
    })

    const pillNow = container.querySelector(
      '[data-testid="hero-player-unmute-pill"]',
    )
    expect(pillNow).not.toBeNull()
    expect(pillNow?.getAttribute("data-state")).toBe("tap-to-unmute")

    // Phase 2: snapshot a non-zero playhead, swap play() back to resolve
    // (so click 2 hits the tap-to-unmute branch's setChromeRevealed path),
    // and trap any currentTime writes.
    if (mockPlayerRef.current) {
      mockPlayerRef.current.currentTime = 5.5
      mockPlayerRef.current.play = vi.fn(() => Promise.resolve())
    }
    const events: string[] = []
    if (mockPlayerRef.current) {
      const player = mockPlayerRef.current
      let currentTime = player.currentTime
      Object.defineProperty(player, "currentTime", {
        get: () => currentTime,
        set: (v: number) => {
          currentTime = v
          events.push("currentTime=" + String(v))
        },
        configurable: true,
      })
    }

    await act(async () => {
      ;(pillNow as HTMLButtonElement).click()
    })

    // The tap-to-unmute branch must call play() but must NOT touch
    // currentTime — resetting to 0 here is exactly the muted-preview
    // restart the play-with-sound fix removed, and the same rule applies
    // to the autoplay-blocked recovery path.
    expect(events).toEqual([])
    expect(mockPlayerRef.current?.play).toHaveBeenCalledTimes(1)
  })

  it("computes sticky `top` from measured hero height once ResizeObserver fires", async () => {
    // Stub ResizeObserver so we can trigger the height-update callback by
    // hand. JSDOM ships without it; the component falls back to the initial
    // getBoundingClientRect read (which returns 0 in JSDOM, so heroHeight
    // stays null without this stub).
    const callbacks: ResizeObserverCallback[] = []
    class MockResizeObserver {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        callbacks.push(callback)
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    const originalRO = (
      globalThis as { ResizeObserver?: typeof ResizeObserver }
    ).ResizeObserver
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver

    try {
      act(() => {
        root.render(<HeroPlayer block={makeBlock()} />)
      })

      const wrapper = container.querySelector(
        '[data-testid="hero-player-wrapper"]',
      ) as HTMLDivElement
      expect(wrapper).not.toBeNull()
      // Pre-measurement: heroHeight is null, top falls back to "0px".
      expect(wrapper.style.top).toBe("0px")

      // Fire the observer with a 1071px (16:9 at 1920w) measurement.
      await act(async () => {
        callbacks[0]?.(
          [
            { contentRect: { height: 1071 } } as ResizeObserverEntry,
          ] as ResizeObserverEntry[],
          {} as ResizeObserver,
        )
      })

      // Spot-check the substantive parts of the calc — JSDOM's CSS
      // serializer normalizes whitespace inconsistently around operators
      // inside min(), so we don't pin the exact format.
      const top = wrapper.style.top
      expect(top.startsWith("min(")).toBe(true)
      expect(top).toContain("0px")
      expect(top).toContain("calc(100svh - 1071px)")
    } finally {
      if (originalRO) {
        ;(
          globalThis as { ResizeObserver?: typeof ResizeObserver }
        ).ResizeObserver = originalRO
      } else {
        delete (globalThis as { ResizeObserver?: typeof ResizeObserver })
          .ResizeObserver
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Timeline pointer-driven scrub. JSDOM's getBoundingClientRect returns zeros,
// so we stub it on the timeline element. The vitest setup polyfills rAF as
// `setTimeout(fn, 0)`, so `vi.useFakeTimers()` lets us deterministically flush
// the coalesced seek by advancing 0ms.
// ---------------------------------------------------------------------------

function stubTimelineRect(): HTMLDivElement {
  const tl = container.querySelector(
    '[data-testid="hero-chrome-timeline"]',
  ) as HTMLDivElement
  Object.defineProperty(tl, "getBoundingClientRect", {
    value: () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 1,
        width: 100,
        height: 1,
        toJSON() {
          return this
        },
      }) as DOMRect,
    configurable: true,
  })
  // JSDOM lacks setPointerCapture / hasPointerCapture. Stub them to no-ops
  // so the production code's defensive guards don't throw under test. Cast
  // through unknown so we can attach element-level methods that JSDOM
  // hasn't implemented; production browsers ship them on every Element.
  const noop = (): void => undefined
  ;(tl as unknown as { setPointerCapture: () => void }).setPointerCapture = noop
  ;(
    tl as unknown as { releasePointerCapture: () => void }
  ).releasePointerCapture = noop
  ;(tl as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture =
    () => false
  return tl
}

function makePointerEvent(
  type: string,
  init: { clientX?: number; pointerId?: number } = {},
): PointerEvent {
  // JSDOM lacks PointerEvent; fall back to MouseEvent + manual fields.
  const Ctor =
    typeof PointerEvent === "function" ? PointerEvent : (MouseEvent as never)
  const evt = new Ctor(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
  }) as PointerEvent
  Object.defineProperty(evt, "pointerId", {
    value: init.pointerId ?? 1,
    configurable: true,
  })
  return evt
}

describe("HeroPlayer — timeline pointer-driven scrub", () => {
  it("data-dragging flips to 'true' on pointerdown and 'false' on pointerup", async () => {
    await revealChrome()
    if (mockPlayerRef.current) {
      mockPlayerRef.current.duration = 60
      mockPlayerRef.current.paused = false
    }
    const tl = stubTimelineRect()
    expect(tl.getAttribute("data-dragging")).toBe("false")
    await act(async () => {
      tl.dispatchEvent(makePointerEvent("pointerdown", { clientX: 50 }))
    })
    expect(tl.getAttribute("data-dragging")).toBe("true")
    await act(async () => {
      tl.dispatchEvent(makePointerEvent("pointerup", { clientX: 50 }))
    })
    expect(tl.getAttribute("data-dragging")).toBe("false")
  })

  it("data-current-time reflects scrubPct * duration during drag (not player.currentTime)", async () => {
    await revealChrome()
    if (mockPlayerRef.current) {
      mockPlayerRef.current.duration = 60
      mockPlayerRef.current.currentTime = 10
      mockPlayerRef.current.paused = false
    }
    const tl = stubTimelineRect()
    await act(async () => {
      tl.dispatchEvent(makePointerEvent("pointerdown", { clientX: 25 })) // 25/100 * 60 = 15
    })
    const time = container.querySelector(
      '[data-testid="hero-chrome-time"]',
    ) as HTMLElement
    // displayTime should follow the scrub thumb (15s), not currentTime (10s).
    expect(time.getAttribute("data-current-time")).toBe("15")
    await act(async () => {
      tl.dispatchEvent(makePointerEvent("pointermove", { clientX: 75 })) // 75/100 * 60 = 45
    })
    expect(time.getAttribute("data-current-time")).toBe("45")
  })

  it("pointerdown pauses a playing player; pointerup resumes if was playing", async () => {
    await revealChrome()
    if (mockPlayerRef.current) {
      mockPlayerRef.current.duration = 60
      mockPlayerRef.current.paused = false
      mockPlayerRef.current.pause.mockClear()
      mockPlayerRef.current.play.mockClear()
    }
    const tl = stubTimelineRect()
    await act(async () => {
      tl.dispatchEvent(makePointerEvent("pointerdown", { clientX: 50 }))
    })
    expect(mockPlayerRef.current?.pause).toHaveBeenCalledTimes(1)
    // Simulate the pause taking effect so the resume gate (p.paused) is true.
    if (mockPlayerRef.current) mockPlayerRef.current.paused = true
    await act(async () => {
      tl.dispatchEvent(makePointerEvent("pointerup", { clientX: 60 }))
    })
    expect(mockPlayerRef.current?.play).toHaveBeenCalledTimes(1)
  })

  it("lostPointerCapture clears drag state and resumes if was playing", async () => {
    await revealChrome()
    if (mockPlayerRef.current) {
      mockPlayerRef.current.duration = 60
      mockPlayerRef.current.paused = false
      mockPlayerRef.current.play.mockClear()
    }
    const tl = stubTimelineRect()
    await act(async () => {
      tl.dispatchEvent(makePointerEvent("pointerdown", { clientX: 50 }))
    })
    expect(tl.getAttribute("data-dragging")).toBe("true")
    if (mockPlayerRef.current) mockPlayerRef.current.paused = true
    await act(async () => {
      tl.dispatchEvent(
        new Event("lostpointercapture", { bubbles: true }) as never,
      )
    })
    expect(tl.getAttribute("data-dragging")).toBe("false")
    expect(mockPlayerRef.current?.play).toHaveBeenCalledTimes(1)
  })
})

describe("HeroPlayer — timeline pointer-driven scrub (fake-timer driven)", () => {
  // Fake timers let us hold the rAF (polyfilled as setTimeout(0)) before it
  // flushes, so we can prove the coalescing window and the unmount
  // cancellation path. Microtasks (the play() promise inside revealChrome)
  // still resolve under fake timers, so reveal works without real time.
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("multiple pointermoves coalesce into a single rAF flush per batch", async () => {
    await revealChrome()
    if (mockPlayerRef.current) {
      // Mock's addEventListener is vi.fn() so durationchange never fires —
      // React state is whatever the initial sync() captured (default 60).
      // The rAF callback reads p.duration directly (F6), so 100 is what the
      // coalesced seek will use; the synchronous pointerdown seek uses the
      // closed-over state duration of 60.
      mockPlayerRef.current.duration = 100
      mockPlayerRef.current.currentTime = 0
      mockPlayerRef.current.paused = false
    }
    const tl = stubTimelineRect()
    await act(async () => {
      tl.dispatchEvent(makePointerEvent("pointerdown", { clientX: 10 }))
    })
    // Pointerdown's synchronous seek uses state-duration (60): 0.1 * 60 = 6.
    expect(mockPlayerRef.current?.currentTime).toBe(6)

    // Track every currentTime write to prove only one happens per batch.
    let writes = 0
    let lastWrite = mockPlayerRef.current?.currentTime ?? 0
    if (mockPlayerRef.current) {
      const player = mockPlayerRef.current
      let ct = player.currentTime
      Object.defineProperty(player, "currentTime", {
        get: () => ct,
        set: (v: number) => {
          ct = v
          writes++
          lastWrite = v
        },
        configurable: true,
      })
    }

    // Three pointermoves before the rAF flushes — only the last should land.
    await act(async () => {
      tl.dispatchEvent(makePointerEvent("pointermove", { clientX: 30 }))
      tl.dispatchEvent(makePointerEvent("pointermove", { clientX: 50 }))
      tl.dispatchEvent(makePointerEvent("pointermove", { clientX: 70 }))
    })
    // Before timers fire, no seek write has landed since the trap was
    // installed.
    expect(writes).toBe(0)
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    // Exactly one rAF wrote the latest pct (0.7 * live p.duration = 70).
    expect(writes).toBe(1)
    expect(lastWrite).toBe(70)
  })

  it("unmounting mid-drag does not write currentTime after unmount", async () => {
    await revealChrome()
    if (mockPlayerRef.current) {
      mockPlayerRef.current.duration = 100
      mockPlayerRef.current.currentTime = 0
      mockPlayerRef.current.paused = false
    }
    const tl = stubTimelineRect()
    await act(async () => {
      tl.dispatchEvent(makePointerEvent("pointerdown", { clientX: 10 }))
    })

    // Trap any subsequent currentTime writes.
    let writes = 0
    if (mockPlayerRef.current) {
      const player = mockPlayerRef.current
      let ct = player.currentTime
      Object.defineProperty(player, "currentTime", {
        get: () => ct,
        set: (v: number) => {
          ct = v
          writes++
        },
        configurable: true,
      })
    }

    // Queue a coalesced seek for the pending rAF.
    await act(async () => {
      tl.dispatchEvent(makePointerEvent("pointermove", { clientX: 90 }))
    })
    // Pre-flush: the rAF hasn't fired, so no seek write yet.
    expect(writes).toBe(0)

    act(() => {
      root.unmount()
    })
    // Re-create root so afterEach's unmount() targets a fresh tree.
    root = createRoot(container)

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(writes).toBe(0)
  })
})
