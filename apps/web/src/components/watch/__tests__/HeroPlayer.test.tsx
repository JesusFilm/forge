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
  onError?: (event: Event & { detail?: { code?: string } }) => void
}

const { muxPlayerMock, mockPlayerRef } = vi.hoisted(() => {
  type MockPlayer = {
    muted: boolean
    currentTime: number
    paused: boolean
    duration: number
    loop: boolean
    play: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
  }

  // Singleton ref proxy — tests reset its fields in `beforeEach`.
  const mockPlayerRef: { current: MockPlayer | null } = { current: null }
  function makePlayer(): MockPlayer {
    return {
      muted: true,
      currentTime: 0,
      paused: false,
      duration: 60,
      loop: true,
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
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
  it("synchronously assigns muted=false, currentTime=0, then calls play() inside the click task", async () => {
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

    expect(events).toEqual(["muted=false", "currentTime=0", "play()"])
    expect(mockPlayerRef.current?.play).toHaveBeenCalledTimes(1)
  })

  it("on play() success: reveals chrome (data-chrome-revealed=true) and disables loop", async () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    const pill = container.querySelector(
      '[data-testid="hero-player-unmute-pill"]',
    ) as HTMLButtonElement

    await act(async () => {
      pill.click()
    })

    // After successful play, the unmute pill is gone (or pill state is
    // 'revealed') and the wrapper exposes data-chrome-revealed.
    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    ) as HTMLElement
    expect(wrapper.getAttribute("data-chrome-revealed")).toBe("true")

    // Re-rendered MuxPlayer should now have `loop=false` and no chrome-hide
    // CSS variables.
    const props = lastMuxProps()
    expect(props.loop).toBe(false)
    const style = (props.style as Record<string, string | undefined>) ?? {}
    expect(style?.["--controls"]).toBeUndefined()
  })

  it("on play() rejection (iOS NotAllowedError): pill switches to 'Tap to Unmute' (visually distinct)", async () => {
    // Override the mocked play() to reject, simulating iOS unmute-with-no-gesture.
    mockPlayerRef.current = {
      muted: true,
      currentTime: 0,
      paused: false,
      duration: 60,
      loop: true,
      play: vi.fn(() => Promise.reject(new Error("NotAllowedError"))),
      pause: vi.fn(),
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
