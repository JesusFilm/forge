/**
 * @vitest-environment jsdom
 *
 * U5 — HeroPlayer tests.
 *
 * The MuxVideo backend is mocked at the module boundary so we can:
 *   - Capture the props passed to `<MuxVideo>` (Mux Data wiring, poster,
 *     bounded HLS config, playback id).
 *   - Stub the ref with a controllable shape so the iOS-safe click sequence
 *     is observable (synchronous `.muted` / `.currentTime` assignments
 *     followed by `.play()` returning a Promise).
 *
 * These tests do not assert real Mux media playback; browser smoke owns that
 * integration surface.
 */

import { act, useImperativeHandle } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type MuxVideoCapturedProps = Record<string, unknown> & {
  ref?: React.Ref<unknown>
  onLoadedMetadata?: (event: Event) => void
  onCanPlay?: (event: Event) => void
  onPlaying?: (event: Event) => void
  onWaiting?: (event: Event) => void
  onStalled?: (event: Event) => void
  onSeeking?: (event: Event) => void
  onSeeked?: (event: Event) => void
  onError?: (event: Event & { detail?: { code?: string } }) => void
}

const { muxVideoMock, mockPlayerRef } = vi.hoisted(() => {
  type MockPlayer = {
    muted: boolean
    currentTime: number
    paused: boolean
    ended: boolean
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
      ended: false,
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

  const muxVideoMock = vi.fn((props: MuxVideoCapturedProps) => {
    const { ref } = props
    mockPlayerRef.current ??= makePlayer()
    useImperativeHandle(ref as React.RefObject<unknown>, () => {
      return mockPlayerRef.current
    })
    return null
  })

  return { muxVideoMock, mockPlayerRef }
})

vi.mock("@forge/video-player", () => ({
  MuxVideo: muxVideoMock,
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations:
    (
      namespace:
        | "HeroPlayer"
        | "VideoLabels"
        | "BibleQuotes"
        | "LanguagePickerModal",
    ) =>
    (key: string, values?: { count?: number }) => {
      const catalogs = {
        HeroPlayer: {
          playWithSound: "Watch now",
          tapToUnmute: "Tap to Unmute",
        },
        VideoLabels: {
          episode: "Episode",
          segment: "Segment",
          video: "Video",
        },
        BibleQuotes: {
          share: "Share",
        },
        LanguagePickerModal: {
          languageCount:
            values?.count === 1
              ? "1 language"
              : `${values?.count ?? 0} languages`,
        },
      }

      const group = catalogs[namespace] as Record<string, string> | undefined
      return group?.[key] ?? key
    },
}))

// HeroPlayer wraps the MuxVideo backend in `next/dynamic(() =>
// import("@forge/video-player/mux-video"), { ssr: false })`.
vi.mock("@forge/video-player/mux-video", () => ({
  default: muxVideoMock,
}))

// In production `next/dynamic` returns a Suspense-wrapped lazy
// component; in vitest we want the synchronous mock return. Bypass the
// async loader and resolve to the mocked default export inline.
vi.mock("next/dynamic", async () => {
  const { createElement } = await import("react")
  return {
    default: (
      loader: () => Promise<{ default: React.ComponentType<unknown> }>,
    ) => {
      let Resolved: React.ComponentType<unknown> | null = null
      void loader().then((mod) => {
        Resolved = mod.default
      })
      return function DynamicMock(props: Record<string, unknown>) {
        // `vi.mock` resolves the inner import synchronously, so by the
        // time React renders this stub the `.then` continuation has
        // already populated `Resolved`. The null-guard is defensive only.
        return Resolved ? createElement(Resolved, props) : null
      }
    },
  }
})

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_MUX_DATA_ENV_KEY: undefined,
  },
}))

// Configurable URLSearchParams stand-in so individual tests can drive the
// useSearchParams hook to specific values (e.g. ?autoplay=1) without
// shadowing the module-scope mock.
const { mockRouterPush, mockSearchParams } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
  mockSearchParams: { current: new URLSearchParams() },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useSearchParams: () => mockSearchParams.current,
}))

function setSearchParams(query: string) {
  mockSearchParams.current = new URLSearchParams(query)
}

import {
  getHeroPosterBlurDataURL,
  HeroPlayer,
} from "@/components/watch/HeroPlayer"

type TestMockPlayer = NonNullable<typeof mockPlayerRef.current>

function expectMuxPosterUrl(
  value: string | null,
  playbackId: string,
  expectedWidth?: string,
) {
  expect(value).not.toBeNull()
  const url = new URL(value!)
  expect(url.origin).toBe("https://image.mux.com")
  expect(url.pathname).toBe(`/${playbackId}/thumbnail.webp`)
  expect(url.searchParams.get("time")).toBe("2")
  if (expectedWidth !== undefined) {
    expect(url.searchParams.get("width")).toBe(expectedWidth)
  } else {
    expect(url.searchParams.has("width")).toBe(false)
  }
}

function makeTestPlayer(
  overrides: Partial<TestMockPlayer> = {},
): TestMockPlayer {
  return {
    muted: true,
    currentTime: 0,
    paused: false,
    ended: false,
    duration: 60,
    volume: 1,
    loop: true,
    buffered: null,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    ...overrides,
  } as TestMockPlayer
}
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"
import type { WatchHeroPlayerBlock } from "@/lib/content"
import {
  WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
  WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
  type WatchHeaderLanguageSwitcherDetail,
  type WatchPlayerChromeVisibilityDetail,
} from "@/lib/watch-player-chrome-events"
import { WATCH_PRODUCTION_PLAYER_OVERLAY_BACKGROUND } from "@/lib/watch-production-overlays"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  muxVideoMock.mockClear()
  mockPlayerRef.current = null
  mockRouterPush.mockClear()
  mockSearchParams.current = new URLSearchParams()
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

function makeBlock({
  muxHeroPosterBlurDataUrl = null,
  playbackId = "playback-id-123",
  nextWatchItem = null,
  duration = null,
  downloads = [],
  subtitles = [],
  publishedAt = null,
}: {
  muxHeroPosterBlurDataUrl?: string | null
  playbackId?: string | null
  nextWatchItem?: WatchHeroPlayerBlock["nextWatchItem"]
  duration?: number | null
  downloads?: WatchHeroPlayerBlock["variant"]["downloads"]
  subtitles?: WatchHeroPlayerBlock["video"]["subtitles"]
  publishedAt?: string | null
} = {}): WatchHeroPlayerBlock {
  return {
    kind: "HeroPlayer",
    video: {
      documentId: "video-1",
      label: "EPISODE",
      slug: "jesus",
      title: "Jesus",
      publishedAt,
      children: [],
      parents: [],
      subtitles,
    } as never,
    variant: {
      documentId: "variant-1",
      slug: "english",
      published: true,
      hls: "https://cdn.example/jesus.m3u8",
      duration,
      downloads,
      muxVideo: playbackId ? { playbackId } : null,
      muxHeroPosterBlurDataUrl,
      language: {
        coreId: "529",
        bcp47: "en",
        slug: "english",
        name: "English",
      },
    } as never,
    nextWatchItem,
  }
}

async function revealAutoplayPlayer() {
  await act(async () => {
    lastMuxProps().onCanPlay?.(new Event("canplay"))
    await Promise.resolve()
  })
}

function callPlayerListener(eventName: string) {
  const player = mockPlayerRef.current
  const listeners =
    player?.addEventListener.mock.calls.flatMap((call, index) => {
      const [event, listener] = call
      if (event !== eventName || typeof listener !== "function") return []
      const addOrder = player.addEventListener.mock.invocationCallOrder[index]
      const removed = player.removeEventListener.mock.calls.some(
        (removeCall, removeIndex) => {
          const [removedEvent, removedListener] = removeCall
          const removeOrder =
            player.removeEventListener.mock.invocationCallOrder[removeIndex]
          return (
            removedEvent === eventName &&
            removedListener === listener &&
            removeOrder != null &&
            addOrder != null &&
            removeOrder > addOrder
          )
        },
      )
      return removed ? [] : [listener as () => void]
    }) ?? []
  expect(listeners.length).toBeGreaterThan(0)
  act(() => {
    for (const listener of listeners) listener()
  })
}

function lastMuxProps(): MuxVideoCapturedProps {
  const calls = muxVideoMock.mock.calls
  return calls[calls.length - 1]?.[0] as MuxVideoCapturedProps
}

type TestIdleDeadline = {
  didTimeout: boolean
  timeRemaining: () => number
}

function installIdleCallbackStub() {
  const idleCallbacks: Array<(deadline: TestIdleDeadline) => void> = []
  const windowWithIdle = window as Window & {
    requestIdleCallback?: (
      callback: (deadline: TestIdleDeadline) => void,
    ) => number
    cancelIdleCallback?: (handle: number) => void
  }
  const originalRequestIdleCallback = windowWithIdle.requestIdleCallback
  const originalCancelIdleCallback = windowWithIdle.cancelIdleCallback
  const originalSetTimeout = window.setTimeout
  const originalClearTimeout = window.clearTimeout
  const previewDelayTimers = new Map<number, () => void>()
  const fastPreviewTimers = new Map<number, () => void>()
  let previewDelayTimerId = 0
  let fastPreviewTimerId = 10_000

  Object.defineProperty(windowWithIdle, "requestIdleCallback", {
    configurable: true,
    value: vi.fn((callback: (deadline: TestIdleDeadline) => void) => {
      idleCallbacks.push(callback)
      return idleCallbacks.length
    }),
  })
  Object.defineProperty(windowWithIdle, "cancelIdleCallback", {
    configurable: true,
    value: vi.fn((handle: number) => {
      idleCallbacks.splice(Math.max(0, handle - 1), 1)
    }),
  })
  Object.defineProperty(window, "setTimeout", {
    configurable: true,
    value: vi.fn(
      (callback: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 8000 && typeof callback === "function") {
          const handle = ++previewDelayTimerId
          previewDelayTimers.set(handle, () => callback(...args))
          callback(...args)
          return handle
        }
        if (timeout === 700 && typeof callback === "function") {
          const handle = ++fastPreviewTimerId
          fastPreviewTimers.set(handle, () => callback(...args))
          return handle
        }
        return originalSetTimeout(callback, timeout, ...args)
      },
    ) as unknown as typeof window.setTimeout,
  })
  Object.defineProperty(window, "clearTimeout", {
    configurable: true,
    value: vi.fn((handle?: number) => {
      if (typeof handle === "number" && previewDelayTimers.delete(handle)) {
        return
      }
      if (typeof handle === "number" && fastPreviewTimers.delete(handle)) {
        return
      }
      return originalClearTimeout(handle)
    }) as typeof window.clearTimeout,
  })

  return {
    get pending() {
      return idleCallbacks.length
    },
    get pendingFastTimers() {
      return fastPreviewTimers.size
    },
    runNextFastTimer: async () => {
      const [handle, callback] = fastPreviewTimers.entries().next().value ?? []
      if (handle != null) fastPreviewTimers.delete(handle)
      await act(async () => {
        callback?.()
      })
    },
    runNext: async () => {
      const callback = idleCallbacks.shift()
      await act(async () => {
        callback?.({
          didTimeout: false,
          timeRemaining: () => 50,
        })
      })
    },
    restore: () => {
      if (originalRequestIdleCallback) {
        windowWithIdle.requestIdleCallback = originalRequestIdleCallback
      } else {
        Reflect.deleteProperty(windowWithIdle, "requestIdleCallback")
      }
      if (originalCancelIdleCallback) {
        windowWithIdle.cancelIdleCallback = originalCancelIdleCallback
      } else {
        Reflect.deleteProperty(windowWithIdle, "cancelIdleCallback")
      }
      window.setTimeout = originalSetTimeout
      window.clearTimeout = originalClearTimeout
    },
  }
}

async function activateMutedPreviewFromIdle() {
  const idle = installIdleCallbackStub()
  try {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })
    expect(idle.pending).toBeGreaterThan(0)
    await idle.runNext()
  } finally {
    idle.restore()
  }
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

async function firePlaying() {
  const handler = lastMuxProps()?.onPlaying
  await act(async () => {
    handler?.(new Event("playing"))
  })
}

async function fireWaiting() {
  const handler = lastMuxProps()?.onWaiting
  await act(async () => {
    handler?.(new Event("waiting"))
  })
}

async function fireSeeked() {
  const handler = lastMuxProps()?.onSeeked
  await act(async () => {
    handler?.(new Event("seeked"))
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
  it("renders the LCP poster first without mounting a Mux backend", () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    const poster = container.querySelector(
      '[data-testid="hero-player-poster"]',
    ) as HTMLImageElement
    expect(poster).not.toBeNull()
    expectMuxPosterUrl(poster.getAttribute("src"), "playback-id-123", "1280")
    expect(poster.getAttribute("srcset")).toContain("width=640")
    expect(poster.getAttribute("loading")).toBe("eager")
    expect(poster.getAttribute("fetchpriority")).toBe("high")
    expect(muxVideoMock).not.toHaveBeenCalled()
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).toBeNull()
  })

  it("renders the text Share action beside Watch now only while the hero is unrevealed", async () => {
    const onShareClick = vi.fn()
    act(() => {
      root.render(
        <HeroPlayer block={makeBlock()} onShareClick={onShareClick} />,
      )
    })

    const watchNow = container.querySelector(
      '[data-testid="hero-player-unmute-pill"]',
    ) as HTMLButtonElement
    const share = container.querySelector(
      '[data-testid="hero-player-share-button"]',
    ) as HTMLButtonElement

    expect(share.previousElementSibling).toBe(watchNow)
    expect(share.type).toBe("button")
    expect(share.textContent).toBe("Share")
    expect(share.querySelector("svg")).not.toBeNull()
    expect(share.className).toContain("bg-transparent")
    expect(share.className).toContain("border-transparent")
    expect(share.className).toContain("hover:border-white/50")
    expect(share.className).toContain("hover:bg-white/12")

    await act(async () => {
      share.click()
    })
    expect(onShareClick).toHaveBeenCalledTimes(1)
    expect(muxVideoMock).not.toHaveBeenCalled()

    await act(async () => {
      watchNow.click()
    })
    expect(
      container.querySelector('[data-testid="hero-player-share-button"]'),
    ).toBeNull()
  })

  it("renders release metadata before the language tag and opens the language picker", async () => {
    const onLanguageClick = vi.fn()
    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock({
            duration: 1740,
            publishedAt: "2023-06-01T12:00:00.000Z",
            downloads: [
              {
                documentId: "download-hd",
                height: 720,
                quality: "high",
                size: null,
              },
              {
                documentId: "download-uhd",
                height: null,
                quality: "uhd",
                size: null,
              },
            ],
            subtitles: [
              {
                documentId: "subtitle-en",
                language: {
                  slug: "english",
                  name: "English",
                  nativeName: null,
                  bcp47: "en",
                },
                vttSrc: "https://cdn.example/subtitles.vtt",
                primary: true,
                aiGenerated: false,
              },
            ],
          })}
          onLanguageClick={onLanguageClick}
          playableLanguageCount={3}
        />,
      )
    })

    const tags = container.querySelector(
      '[data-testid="hero-player-metadata-tags"]',
    ) as HTMLDivElement
    expect(tags).not.toBeNull()
    expect(tags.className).toContain("mt-3")
    expect(
      Array.from(tags.children).map((tag) => tag.getAttribute("data-testid")),
    ).toEqual([
      "hero-player-release-metadata",
      "hero-player-language-tag",
      "hero-player-captions-tag",
      "hero-player-quality-tag",
    ])

    const languageTag = container.querySelector(
      '[data-testid="hero-player-language-tag"]',
    ) as HTMLButtonElement
    expect(
      container.querySelector('[data-testid="hero-player-release-metadata"]')
        ?.textContent,
    ).toBe("2023 · 29 min")
    expect(
      container.querySelector('[data-testid="hero-player-release-metadata"]')
        ?.className,
    ).toContain("text-xs")
    expect(
      container.querySelector('[data-testid="hero-player-release-metadata"]')
        ?.className,
    ).toContain("font-normal")
    expect(languageTag.tagName).toBe("BUTTON")
    expect(languageTag.getAttribute("aria-label")).toBe("3 languages")
    expect(languageTag.querySelector("svg")).not.toBeNull()
    expect(languageTag.className).toContain("border-transparent")
    expect(languageTag.className).toContain("bg-transparent")
    expect(languageTag.className).toContain("hover:border-white/70")
    expect(languageTag.className).toContain("hover:bg-white/15")
    expect(languageTag.className).toContain("text-[0.625rem]")
    expect(languageTag.className).toContain("font-normal")
    expect(
      container.querySelector('[data-testid="hero-player-runtime-tag"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="hero-player-captions-tag"]')
        ?.textContent,
    ).toBe("CC")
    expect(
      container.querySelector('[data-testid="hero-player-captions-tag"]')
        ?.className,
    ).toContain("border-white/45")
    expect(
      container.querySelector('[data-testid="hero-player-captions-tag"]')
        ?.className,
    ).not.toContain("border-2")
    expect(
      container.querySelector('[data-testid="hero-player-captions-tag"]')
        ?.className,
    ).toContain("bg-transparent")
    expect(
      container.querySelector('[data-testid="hero-player-captions-tag"]')
        ?.className,
    ).toContain("font-normal")
    expect(
      container.querySelector('[data-testid="hero-player-captions-tag"]')
        ?.className,
    ).toContain("text-[0.6rem]")
    expect(
      container.querySelector('[data-testid="hero-player-captions-tag"]')
        ?.className,
    ).toContain("px-1.5")
    expect(
      container.querySelector('[data-testid="hero-player-quality-tag"]')
        ?.textContent,
    ).toBe("4K")

    await act(async () => {
      languageTag.click()
    })
    expect(onLanguageClick).toHaveBeenCalledTimes(1)
  })

  it("keeps a one-language count informational and omits unavailable factual tags", () => {
    const onLanguageClick = vi.fn()
    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock()}
          onLanguageClick={onLanguageClick}
          playableLanguageCount={1}
        />,
      )
    })

    const languageTag = container.querySelector(
      '[data-testid="hero-player-language-tag"]',
    ) as HTMLSpanElement
    expect(languageTag.tagName).toBe("SPAN")
    expect(languageTag.textContent).toBe("1 language")
    expect(
      container.querySelector('[data-testid="hero-player-runtime-tag"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="hero-player-captions-tag"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="hero-player-quality-tag"]'),
    ).toBeNull()
    expect(onLanguageClick).not.toHaveBeenCalled()
  })

  it("removes the metadata strip when Watch now reveals player chrome", async () => {
    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock({ duration: 394 })}
          playableLanguageCount={1}
        />,
      )
    })

    expect(
      container.querySelector('[data-testid="hero-player-metadata-tags"]'),
    ).not.toBeNull()
    const watchNow = container.querySelector(
      '[data-testid="hero-player-unmute-pill"]',
    ) as HTMLButtonElement

    await act(async () => {
      watchNow.click()
    })

    expect(
      container.querySelector('[data-testid="hero-player-metadata-tags"]'),
    ).toBeNull()
  })

  it("uses the hero-specific Mux blur placeholder for the committed hero poster", () => {
    const blurDataURL = "data:image/webp;base64,BQYHCA=="
    const heroPosterUrl =
      "https://image.mux.com/playback-id-123/thumbnail.webp?time=2"

    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock({ muxHeroPosterBlurDataUrl: blurDataURL })}
        />,
      )
    })

    const poster = container.querySelector(
      '[data-testid="hero-player-poster"]',
    ) as HTMLImageElement
    expect(poster).not.toBeNull()
    expect(
      getHeroPosterBlurDataURL({
        heroPosterUrl,
        muxHeroPosterBlurDataUrl: blurDataURL,
        shouldOptimizeMuxPoster: true,
        visualHeroPosterUrl: heroPosterUrl,
      }),
    ).toBe(blurDataURL)
    expect(
      getHeroPosterBlurDataURL({
        heroPosterUrl,
        muxHeroPosterBlurDataUrl: blurDataURL,
        shouldOptimizeMuxPoster: false,
        visualHeroPosterUrl: "https://cdn.test/clicked.jpg",
      }),
    ).toBeNull()
  })

  it("renders optimistic title and poster on the pre-reveal shell only", () => {
    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock()}
          optimisticVisual={{
            title: "Clicked Chapter",
            label: "SEGMENT",
            posterUrl: "https://cdn.test/clicked.jpg",
          }}
        />,
      )
    })

    const poster = container.querySelector(
      '[data-testid="hero-player-poster"]',
    ) as HTMLImageElement
    expect(poster).not.toBeNull()
    expect(poster.getAttribute("src")).toBe("https://cdn.test/clicked.jpg")
    expect(poster.parentElement?.getAttribute("data-cover-loading")).toBe(
      "false",
    )
    expect(poster.parentElement?.getAttribute("data-cover-transition")).toBe(
      "none",
    )
    expect(poster.parentElement?.className).not.toContain("transition-opacity")
    expect(poster.parentElement?.className).toContain("opacity-100")
    expect(poster.getAttribute("class")).not.toContain("pulse")
    const posterBackdrop = container.querySelector(
      '[data-testid="hero-player-poster-muted-backdrop"]',
    ) as HTMLDivElement
    expect(posterBackdrop).not.toBeNull()
    expect(posterBackdrop.getAttribute("style")).toContain(
      WATCH_PRODUCTION_PLAYER_OVERLAY_BACKGROUND,
    )
    expect(
      container.querySelector('[data-testid="hero-player-cover-black-bridge"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="hero-player-overlay-title"]')
        ?.textContent,
    ).toBe("Clicked Chapter")
    expect(
      container.querySelector('[data-testid="hero-player-overlay-label"]')
        ?.textContent,
    ).toBe("Segment")
    expect(muxVideoMock).not.toHaveBeenCalled()
  })

  it("mirrors muted video darkening on an optimistic poster", () => {
    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock()}
          darkenOverlay
          optimisticVisual={{
            title: "Clicked Chapter",
            label: "SEGMENT",
            posterUrl: "https://cdn.test/clicked.jpg",
          }}
        />,
      )
    })

    expect(
      container.querySelector('[data-testid="hero-player-muted-backdrop"]'),
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="hero-player-poster-muted-backdrop"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="hero-player-darken-overlay"]'),
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="hero-player-poster-darken-overlay"]',
      ),
    ).not.toBeNull()
  })

  it("shows a pending optimistic poster immediately without a black bridge", () => {
    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock()}
          optimisticVisual={{
            title: "Clicked Chapter",
            label: "SEGMENT",
            posterUrl: "https://cdn.test/clicked.jpg",
            posterBlurDataUrl: "data:image/jpeg;base64,AQIDBA==",
            loading: true,
            transitionKey: "chapter-2",
          }}
        />,
      )
    })

    const layer = container.querySelector(
      '[data-testid="hero-player-poster-layer"]',
    )
    const poster = container.querySelector(
      '[data-testid="hero-player-poster"]',
    ) as HTMLImageElement
    const bridge = container.querySelector(
      '[data-testid="hero-player-cover-black-bridge"]',
    )

    expect(layer?.getAttribute("data-cover-loading")).toBe("true")
    expect(layer?.getAttribute("data-cover-transition")).toBe("none")
    expect(poster.getAttribute("src")).toBe("https://cdn.test/clicked.jpg")
    expect(poster.getAttribute("class")).not.toContain(
      "watch-hero-cover-reveal",
    )
    expect(poster.getAttribute("class")).not.toContain("pulse")
    expect(bridge).toBeNull()
  })

  it("blacks out the current cover before optimistic title and poster swap", () => {
    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock()}
          coverBlackoutKey="chapter-2:0"
          coverBlackoutPhase="covering"
        />,
      )
    })

    const poster = container.querySelector(
      '[data-testid="hero-player-poster"]',
    ) as HTMLImageElement
    const blackout = container.querySelector(
      '[data-testid="hero-player-cover-blackout"]',
    )

    expect(
      container.querySelector('[data-testid="hero-player-overlay-title"]')
        ?.textContent,
    ).toBe("Jesus")
    expectMuxPosterUrl(poster.getAttribute("src"), "playback-id-123", "1280")
    expect(poster.parentElement?.getAttribute("data-cover-transition")).toBe(
      "none",
    )
    expect(blackout).not.toBeNull()
  })

  it("does not bridge the committed route poster after the clicked poster", () => {
    const baseBlock = makeBlock()
    const committedBlock: WatchHeroPlayerBlock = {
      ...baseBlock,
      video: {
        ...(baseBlock.video as object),
        documentId: "video-2",
        title: "Clicked Chapter",
      } as never,
      variant: {
        ...(baseBlock.variant as object),
        documentId: "variant-2",
        muxVideo: { playbackId: "route-playback-456" },
      } as never,
    }

    act(() => {
      root.render(
        <HeroPlayer
          block={baseBlock}
          optimisticVisual={{
            title: "Clicked Chapter",
            label: "SEGMENT",
            posterUrl: "https://cdn.test/clicked.jpg",
            loading: true,
            transitionKey: "chapter-2",
          }}
        />,
      )
    })

    act(() => {
      root.render(<HeroPlayer block={committedBlock} />)
    })

    const layer = container.querySelector(
      '[data-testid="hero-player-poster-layer"]',
    )
    const poster = container.querySelector(
      '[data-testid="hero-player-poster"]',
    ) as HTMLImageElement
    const bridge = container.querySelector(
      '[data-testid="hero-player-cover-black-bridge"]',
    )

    expect(layer?.getAttribute("data-cover-loading")).toBe("false")
    expect(layer?.getAttribute("data-cover-transition")).toBe("none")
    expectMuxPosterUrl(poster.getAttribute("src"), "route-playback-456", "1280")
    expect(poster.getAttribute("class")).not.toContain(
      "watch-hero-cover-reveal",
    )
    expect(poster.getAttribute("class")).not.toContain("pulse")
    expect(bridge).toBeNull()
  })

  it("keeps an optimistic poster visible after the muted preview starts", async () => {
    const idle = installIdleCallbackStub()
    const block = makeBlock()
    try {
      act(() => {
        root.render(<HeroPlayer block={block} />)
      })
      await idle.runNext()
      await fireCanPlay()

      const routePoster = container.querySelector(
        '[data-testid="hero-player-poster"]',
      )
      expect(routePoster?.parentElement?.className).toContain("opacity-100")

      await firePlaying()

      expect(routePoster?.parentElement?.className).toContain("opacity-0")

      act(() => {
        root.render(
          <HeroPlayer
            block={block}
            optimisticVisual={{
              title: "Clicked Chapter",
              label: "SEGMENT",
              posterUrl: "https://cdn.test/clicked.jpg",
            }}
          />,
        )
      })

      const optimisticPoster = container.querySelector(
        '[data-testid="hero-player-poster"]',
      ) as HTMLImageElement
      expect(optimisticPoster.getAttribute("src")).toBe(
        "https://cdn.test/clicked.jpg",
      )
      expect(optimisticPoster.parentElement?.className).toContain("opacity-100")
    } finally {
      idle.restore()
    }
  })

  it("keeps the route poster still until playback starts", async () => {
    const idle = installIdleCallbackStub()
    try {
      act(() => {
        root.render(<HeroPlayer block={makeBlock()} />)
      })
      await idle.runNext()

      const layer = container.querySelector(
        '[data-testid="hero-player-poster-layer"]',
      )
      const poster = container.querySelector(
        '[data-testid="hero-player-poster"]',
      ) as HTMLImageElement
      expect(layer?.getAttribute("data-cover-loading")).toBe("true")
      expect(layer?.getAttribute("data-cover-transition")).toBe("none")
      expect(poster.getAttribute("class")).not.toContain("pulse")

      await fireCanPlay()

      const readyLayer = container.querySelector(
        '[data-testid="hero-player-poster-layer"]',
      )
      const readyPoster = container.querySelector(
        '[data-testid="hero-player-poster"]',
      ) as HTMLImageElement
      expect(readyLayer?.getAttribute("data-cover-loading")).toBe("false")
      expect(readyLayer?.className).toContain("opacity-100")
      expect(readyPoster.getAttribute("class")).not.toContain("pulse")

      await firePlaying()

      const playingLayer = container.querySelector(
        '[data-testid="hero-player-poster-layer"]',
      )
      expect(playingLayer?.className).toContain("opacity-0")
    } finally {
      idle.restore()
    }
  })

  it("mounts MuxVideo with LCP poster, bounded HLS config, and Mux Data after idle activation", async () => {
    await activateMutedPreviewFromIdle()

    const props = lastMuxProps()
    expect(props).toBeDefined()
    expect(props.playbackId).toBe("playback-id-123")
    expect(props.autoPlay).toBe(true)
    expect(props.muted).toBe(true)
    expect(props.loop).toBe(true)
    expect(props.preload).toBe("metadata")
    expectMuxPosterUrl(props.poster as string, "playback-id-123")
    expect(props.disableTracking).toBe(false)
    expect(props.disableCookies).toBe(true)
    expect(props.metadata).toMatchObject({
      player_name: "forge-web-watch",
      video_title: "Jesus",
      video_id: "video-1",
    })
    expect(props._hlsConfig).toEqual({
      maxBufferLength: 10,
      maxBufferSize: 5_000_000,
      backBufferLength: 5,
      enableWebVTT: false,
    })
    expect(props.className).toContain("watch-hero-player-video")
    expect(props.style).toEqual({ objectFit: "cover" })
  })

  it("mounts the visible mobile muted preview after load and the short mobile timer", async () => {
    const idle = installIdleCallbackStub()
    const originalInnerWidth = window.innerWidth
    const originalReadyState = document.readyState
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    })
    Object.defineProperty(document, "readyState", {
      configurable: true,
      get: () => "complete",
    })

    try {
      act(() => {
        root.render(<HeroPlayer block={makeBlock()} />)
      })

      expect(muxVideoMock).not.toHaveBeenCalled()
      expect(idle.pending).toBe(0)
      expect(idle.pendingFastTimers).toBe(1)

      await idle.runNextFastTimer()
      expect(muxVideoMock).toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      })
      Object.defineProperty(document, "readyState", {
        configurable: true,
        get: () => originalReadyState,
      })
      idle.restore()
    }
  })

  it("waits for page load before scheduling the fast mobile muted preview", async () => {
    const idle = installIdleCallbackStub()
    const originalInnerWidth = window.innerWidth
    const originalReadyState = document.readyState
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    })
    Object.defineProperty(document, "readyState", {
      configurable: true,
      get: () => "loading",
    })

    try {
      act(() => {
        root.render(<HeroPlayer block={makeBlock()} />)
      })

      expect(muxVideoMock).not.toHaveBeenCalled()
      expect(idle.pending).toBe(0)
      expect(idle.pendingFastTimers).toBe(0)

      Object.defineProperty(document, "readyState", {
        configurable: true,
        get: () => "complete",
      })
      await act(async () => {
        window.dispatchEvent(new Event("load"))
      })

      expect(idle.pending).toBe(0)
      expect(idle.pendingFastTimers).toBe(1)
      await idle.runNextFastTimer()
      expect(muxVideoMock).toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      })
      Object.defineProperty(document, "readyState", {
        configurable: true,
        get: () => originalReadyState,
      })
      idle.restore()
    }
  })

  it("rechecks the mobile fast path when load fires", async () => {
    const idle = installIdleCallbackStub()
    const originalInnerWidth = window.innerWidth
    const originalReadyState = document.readyState
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    })
    Object.defineProperty(document, "readyState", {
      configurable: true,
      get: () => "loading",
    })

    try {
      act(() => {
        root.render(<HeroPlayer block={makeBlock()} />)
      })

      expect(muxVideoMock).not.toHaveBeenCalled()
      expect(idle.pending).toBe(0)
      expect(idle.pendingFastTimers).toBe(0)

      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 390,
      })
      Object.defineProperty(document, "readyState", {
        configurable: true,
        get: () => "complete",
      })
      await act(async () => {
        window.dispatchEvent(new Event("load"))
      })

      expect(idle.pending).toBe(0)
      expect(idle.pendingFastTimers).toBe(1)
      await idle.runNextFastTimer()
      expect(muxVideoMock).toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      })
      Object.defineProperty(document, "readyState", {
        configurable: true,
        get: () => originalReadyState,
      })
      idle.restore()
    }
  })

  it("defers the fast mobile muted preview while the document is hidden", async () => {
    const idle = installIdleCallbackStub()
    const originalInnerWidth = window.innerWidth
    const originalVisibility = document.visibilityState
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    })
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    })

    try {
      act(() => {
        root.render(<HeroPlayer block={makeBlock()} />)
      })

      await idle.runNextFastTimer()
      expect(muxVideoMock).not.toHaveBeenCalled()

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      })
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"))
      })
      expect(idle.pendingFastTimers).toBe(1)
      await idle.runNextFastTimer()
      expect(muxVideoMock).toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      })
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => originalVisibility,
      })
      idle.restore()
    }
  })

  it("defers idle muted activation while the document is hidden", async () => {
    const idle = installIdleCallbackStub()
    const originalVisibility = document.visibilityState
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    })
    try {
      act(() => {
        root.render(<HeroPlayer block={makeBlock()} />)
      })

      await idle.runNext()
      expect(muxVideoMock).not.toHaveBeenCalled()

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      })
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"))
      })
      expect(idle.pending).toBeGreaterThan(0)
      await idle.runNext()
      expect(muxVideoMock).toHaveBeenCalled()
    } finally {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => originalVisibility,
      })
      idle.restore()
    }
  })

  it("defers idle muted activation while the hero is away from the viewport", async () => {
    const idle = installIdleCallbackStub()
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    ) as HTMLDivElement
    Object.defineProperty(wrapper, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          x: 0,
          y: 3000,
          top: 3000,
          bottom: 3300,
          left: 0,
          right: 1000,
          width: 1000,
          height: 300,
          toJSON: () => ({}),
        }) as DOMRect,
    })

    try {
      await idle.runNext()
      expect(muxVideoMock).not.toHaveBeenCalled()

      Object.defineProperty(wrapper, "getBoundingClientRect", {
        configurable: true,
        value: () =>
          ({
            x: 0,
            y: 0,
            top: 0,
            bottom: 300,
            left: 0,
            right: 1000,
            width: 1000,
            height: 300,
            toJSON: () => ({}),
          }) as DOMRect,
      })
      await act(async () => {
        window.dispatchEvent(new Event("scroll"))
      })
      expect(idle.pending).toBeGreaterThan(0)
      await idle.runNext()
      expect(muxVideoMock).toHaveBeenCalled()
    } finally {
      idle.restore()
    }
  })

  it("wires Mux Data metadata after activation: player_name, video_title, viewer_user_id; disableCookies=true", async () => {
    await activateMutedPreviewFromIdle()

    const props = lastMuxProps()
    expect(props.disableCookies).toBe(true)
    const metadata = props.metadata as Record<string, unknown>
    expect(metadata?.player_name).toBe("forge-web-watch")
    expect(metadata?.video_title).toBe("Jesus")
    // viewer_user_id may be `""` on SSR; in jsdom it's a UUID.
    expect(typeof metadata?.viewer_user_id).toBe("string")
  })

  it("animates between the mobile portrait preview height and playback frame height", async () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    ) as HTMLDivElement
    expect(wrapper.className).toContain("h-[min(100svh,56.25vw)]")
    expect(wrapper.className).not.toContain("max-w-[1920px]")
    expect(wrapper.className).not.toContain("h-[calc(100svh-300px)]")
    expect(wrapper.className).not.toContain("min-h-[400px]")
    expect(wrapper.className).toContain("overflow-x-clip")
    expect(wrapper.className).toContain("transition-[height,margin-bottom,top]")
    expect(wrapper.className).toContain(
      "[@media(max-width:767px)_and_(orientation:portrait)]:h-[100vw]",
    )
    expect(wrapper.getAttribute("data-mobile-portrait-preview")).toBe("true")
    expect(wrapper.getAttribute("data-preview-overlap")).toBe("false")
    expect(wrapper.getAttribute("data-preview-overlap-px")).toBe("0")
    expect(wrapper.getAttribute("style")).toContain("margin-bottom: 0px")

    expect(
      container.querySelector('[data-testid="hero-player-mobile-header-band"]'),
    ).toBeNull()

    const mediaFrame = container.querySelector(
      '[data-testid="hero-player-media-frame"]',
    ) as HTMLDivElement
    expect(mediaFrame.className).toContain("relative")
    expect(mediaFrame.className).toContain(
      "[@media(max-width:767px)_and_(orientation:portrait)]:overflow-hidden",
    )

    const pill = container.querySelector(
      '[data-testid="hero-player-unmute-pill"]',
    ) as HTMLButtonElement
    await act(async () => {
      pill.click()
    })

    expect(wrapper.className).toContain("h-[min(100svh,56.25vw)]")
    expect(wrapper.className).not.toContain("max-w-[1920px]")
    expect(wrapper.className).not.toContain("h-[calc(100svh-300px)]")
    expect(wrapper.className).not.toContain("min-h-[400px]")
    expect(wrapper.className).toContain("overflow-hidden")
    expect(wrapper.className).not.toContain(
      "[@media(max-width:767px)_and_(orientation:portrait)]:h-[100vw]",
    )
    expect(wrapper.getAttribute("data-mobile-portrait-preview")).toBe("false")
    expect(wrapper.getAttribute("data-preview-overlap")).toBe("false")
    expect(wrapper.getAttribute("data-preview-overlap-px")).toBe("0")
    expect(wrapper.getAttribute("style")).toContain("margin-bottom: 0px")
    expect(
      container.querySelector('[data-testid="hero-player-mobile-header-band"]'),
    ).toBeNull()
    expect(mediaFrame.className).not.toContain(
      "[@media(max-width:767px)_and_(orientation:portrait)]:overflow-hidden",
    )
  })

  it("uses the media frame itself for the default mobile portrait muted preview", async () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    ) as HTMLDivElement
    const mediaFrame = container.querySelector(
      '[data-testid="hero-player-media-frame"]',
    ) as HTMLDivElement
    const clickSurface = container.querySelector(
      '[data-testid="hero-player-pre-reveal-click-surface"]',
    ) as HTMLButtonElement
    const loadingBeforeActivation = container.querySelector(
      '[data-testid="hero-player-loading"]',
    )
    const backdrop = container.querySelector(
      '[data-testid="hero-player-muted-backdrop"]',
    )
    const poster = container.querySelector('[data-testid="hero-player-poster"]')

    expect(wrapper.getAttribute("data-mobile-portrait-preview")).toBe("true")
    expect(
      container.querySelector('[data-testid="hero-player-mobile-header-band"]'),
    ).toBeNull()
    expect(mediaFrame.className).toContain("w-full")
    expect(mediaFrame.className).toContain(
      "[@media(max-width:767px)_and_(orientation:portrait)]:overflow-hidden",
    )
    expect(muxVideoMock).not.toHaveBeenCalled()
    expect(poster?.parentElement?.parentElement).toBe(mediaFrame)
    expect(clickSurface?.parentElement).toBe(mediaFrame)
    expect(loadingBeforeActivation).toBeNull()
    expect(backdrop?.parentElement).toBe(mediaFrame)

    await act(async () => {
      clickSurface.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    })

    const loading = container.querySelector(
      '[data-testid="hero-player-loading"]',
    )
    const props = lastMuxProps()
    expect(props.className).toContain("scale-y-110")
    expect(props.className).toContain(
      "[@media(max-width:767px)_and_(orientation:portrait)]:scale-y-100",
    )
    expect(loading).toBeNull()
  })

  it("keeps custom overlay consumers on the existing muted preview frame", async () => {
    const idle = installIdleCallbackStub()
    try {
      act(() => {
        root.render(
          <HeroPlayer
            block={makeBlock()}
            overlay={<div data-testid="custom-overlay">Custom</div>}
          />,
        )
      })

      const wrapper = container.querySelector(
        '[data-testid="hero-player-wrapper"]',
      ) as HTMLDivElement
      const mediaFrame = container.querySelector(
        '[data-testid="hero-player-media-frame"]',
      ) as HTMLDivElement

      expect(wrapper.getAttribute("data-mobile-portrait-preview")).toBe("false")
      expect(
        container.querySelector(
          '[data-testid="hero-player-mobile-header-band"]',
        ),
      ).toBeNull()
      expect(mediaFrame.className).not.toContain(
        "[@media(max-width:767px)_and_(orientation:portrait)]:overflow-hidden",
      )
      expect(muxVideoMock).not.toHaveBeenCalled()

      await idle.runNext()

      const props = lastMuxProps()
      expect(props.className).toContain("scale-y-110")
      expect(props.className).not.toContain(
        "[@media(max-width:767px)_and_(orientation:portrait)]:scale-y-100",
      )
    } finally {
      idle.restore()
    }
  })

  it("pulls the episode rail over the muted preview only by the measured amount needed to fit", async () => {
    const originalInnerHeight = window.innerHeight
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
    })
    const ro = installResizeObserverStub()

    const setRect = (
      el: Element,
      rect: { top: number; bottom: number; height: number; width?: number },
    ) => {
      Object.defineProperty(el, "getBoundingClientRect", {
        configurable: true,
        value: () =>
          ({
            x: 0,
            y: rect.top,
            top: rect.top,
            bottom: rect.bottom,
            left: 0,
            right: rect.width ?? 1000,
            width: rect.width ?? 1000,
            height: rect.height,
            toJSON: () => ({}),
          }) as DOMRect,
      })
    }

    vi.useFakeTimers()
    try {
      act(() => {
        root.render(
          <>
            <HeroPlayer block={makeBlock()} />
            <section data-testid="watch-body-zone">
              <div data-block-type="SiblingCarousel" />
            </section>
          </>,
        )
      })

      const wrapper = container.querySelector(
        '[data-testid="hero-player-wrapper"]',
      ) as HTMLDivElement
      const body = container.querySelector(
        '[data-testid="watch-body-zone"]',
      ) as HTMLElement
      const rail = container.querySelector(
        '[data-block-type="SiblingCarousel"]',
      ) as HTMLElement

      setRect(body, { top: 600, bottom: 1000, height: 400 })
      setRect(rail, { top: 616, bottom: 856, height: 240 })

      await ro.setHeight(600)
      expect(wrapper.getAttribute("data-preview-overlap")).toBe("false")
      expect(wrapper.getAttribute("data-preview-overlap-px")).toBe("0")

      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 700,
      })
      await act(async () => {
        window.dispatchEvent(new Event("resize"))
        await vi.runOnlyPendingTimersAsync()
      })

      expect(wrapper.getAttribute("data-preview-overlap")).toBe("true")
      expect(wrapper.getAttribute("data-preview-overlap-px")).toBe("188")
      expect(wrapper.getAttribute("style")).toContain("margin-bottom: -188px")
    } finally {
      vi.useRealTimers()
      ro.restore()
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      })
    }
  })

  it("clears the muted-preview overlap and scrolls back to the hero when sound starts from a scrolled page", async () => {
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 240,
    })
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    vi.useFakeTimers()
    try {
      act(() => {
        root.render(<HeroPlayer block={makeBlock()} />)
      })

      const wrapper = container.querySelector(
        '[data-testid="hero-player-wrapper"]',
      ) as HTMLDivElement
      expect(wrapper.getAttribute("data-preview-overlap")).toBe("false")

      const pill = container.querySelector(
        '[data-testid="hero-player-unmute-pill"]',
      ) as HTMLButtonElement
      await act(async () => {
        pill.click()
      })
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(wrapper.getAttribute("data-preview-overlap")).toBe("false")
      expect(wrapper.getAttribute("style")).toContain("margin-bottom: 0px")
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" })
    } finally {
      scrollTo.mockRestore()
      vi.useRealTimers()
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 0,
      })
    }
  })

  it("renders a 'Watch now' pill (default state) above the player", () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    const pill = container.querySelector(
      '[data-testid="hero-player-unmute-pill"]',
    )
    const overlay = container.querySelector(
      '[data-testid="hero-player-overlay"]',
    )
    expect(pill).not.toBeNull()
    expect(pill?.tagName.toLowerCase()).toBe("button")
    expect(pill?.getAttribute("type")).toBe("button")
    expect(pill?.hasAttribute("href")).toBe(false)
    expect(pill?.getAttribute("aria-controls")).toBe("watch-hero-player-media")
    expect(overlay?.getAttribute("class")).toContain("bottom-0")
    expect(overlay?.getAttribute("class")).toContain("gap-3")
    expect(overlay?.getAttribute("class")).not.toContain("gap-4")
    expect(overlay?.getAttribute("class")).toContain("pb-12")
    expect(pill?.getAttribute("data-state")).toBe("play-with-sound")
    expect(pill?.textContent).toContain("Watch now")
    expect(pill?.querySelector("path")?.getAttribute("d")).toBe("M8 5v14l11-7z")
    const pillClass = pill?.getAttribute("class") ?? ""
    const pillClassTokens = pillClass.split(/\s+/)
    expect(pillClassTokens).toContain("cursor-pointer")
    expect(pillClassTokens).toContain("bg-brand-red")
    expect(pillClassTokens).toContain("px-5")
    expect(pillClassTokens).toContain("focus-visible:outline-2")
    expect(pillClassTokens).toContain("focus-visible:ring-2")
    expect(pillClassTokens).not.toContain("px-7")
    expect(pillClassTokens).not.toContain("md:px-8")
    expect(pillClassTokens.some((token) => token.startsWith("min-w"))).toBe(
      false,
    )
    expect(pillClassTokens.some((token) => token.startsWith("w-"))).toBe(false)
    expect(pillClassTokens).toContain("font-medium")
    expect(pillClassTokens).not.toContain("font-semibold")
    const title = container.querySelector(
      '[data-testid="hero-player-overlay-title"]',
    )
    expect(title?.getAttribute("class")).toContain("text-balance")
    expect(title?.getAttribute("class")).toContain("break-words")
    expect(title?.getAttribute("class")).toContain("max-w-[calc(100vw-5rem)]")
    expect(title?.getAttribute("class")).not.toContain("whitespace-nowrap")
    expect(
      container.querySelector('[data-testid="hero-player-overlay-label"]')
        ?.className,
    ).toBe(WATCH_SECTION_EYEBROW_CLASS)
    // WCAG 2.5.3 (Label in Name): accessible name must contain the
    // visible label as a substring. The aria-label must mirror the
    // visible "Watch now" text so voice-control engines that match on
    // accessible name still resolve "click watch now".
    expect(pill?.getAttribute("aria-label")).toBe("Watch now")

    const surface = container.querySelector(
      '[data-testid="hero-player-pre-reveal-click-surface"]',
    )
    expect(surface?.getAttribute("aria-hidden")).toBe("true")
    expect(surface?.getAttribute("tabindex")).toBe("-1")
  })

  it("uses the production muted overlay backdrop before chrome is revealed", () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    const backdrop = container.querySelector(
      '[data-testid="hero-player-muted-backdrop"]',
    ) as HTMLDivElement
    expect(backdrop).not.toBeNull()
    expect(backdrop.getAttribute("style")).toContain(
      WATCH_PRODUCTION_PLAYER_OVERLAY_BACKGROUND,
    )
  })
})

describe("HeroPlayer — iOS-safe click sequence (AE1)", () => {
  it("synchronously seeks to 0, unmutes, then calls play() inside the click task", async () => {
    mockPlayerRef.current = makeTestPlayer({ currentTime: 37 })

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
    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      expect(pill.dispatchEvent(clickEvent)).toBe(false)
    })

    expect(clickEvent.defaultPrevented).toBe(true)
    expect(events).toEqual(["currentTime=0", "muted=false", "play()"])
    expect(mockPlayerRef.current?.play).toHaveBeenCalledTimes(1)
  })

  it("pre-reveal video click starts playback from 0 with sound", async () => {
    mockPlayerRef.current = makeTestPlayer({ currentTime: 24 })

    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    expect(mockPlayerRef.current?.muted).toBe(true)
    mockPlayerRef.current?.play.mockClear()

    const surface = container.querySelector(
      '[data-testid="hero-player-pre-reveal-click-surface"]',
    ) as HTMLButtonElement
    expect(surface).not.toBeNull()

    await act(async () => {
      surface.click()
    })

    expect(mockPlayerRef.current?.currentTime).toBe(0)
    expect(mockPlayerRef.current?.muted).toBe(false)
    expect(mockPlayerRef.current?.play).toHaveBeenCalledTimes(1)
  })

  it("primes the player on pointerdown before the sound-intent click", async () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    const surface = container.querySelector(
      '[data-testid="hero-player-pre-reveal-click-surface"]',
    ) as HTMLButtonElement
    expect(surface).not.toBeNull()
    expect(muxVideoMock).not.toHaveBeenCalled()

    await act(async () => {
      surface.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    })

    expect(muxVideoMock).toHaveBeenCalled()
    expect(mockPlayerRef.current).not.toBeNull()
    mockPlayerRef.current?.play.mockClear()

    await act(async () => {
      surface.click()
    })

    expect(mockPlayerRef.current?.play).toHaveBeenCalledTimes(1)
    expect(mockPlayerRef.current?.muted).toBe(false)
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

    // Re-rendered MuxVideo should now have `loop=false` and switch from the
    // cover preview crop to contained sound-on playback.
    const props = lastMuxProps()
    expect(props.loop).toBe(false)
    expect(props.style).toEqual({ objectFit: "contain" })
  })

  it("reveals custom chrome immediately when play() stays pending", async () => {
    mockPlayerRef.current = makeTestPlayer({
      play: vi.fn(() => new Promise<void>(() => undefined)),
    })

    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    const pill = container.querySelector(
      '[data-testid="hero-player-unmute-pill"]',
    ) as HTMLButtonElement

    await act(async () => {
      pill.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    })

    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    ) as HTMLElement
    expect(mockPlayerRef.current?.play).toHaveBeenCalled()
    expect(wrapper.getAttribute("data-chrome-revealed")).toBe("true")
    expect(
      container.querySelector('[data-testid="hero-player-unmute-pill"]'),
    ).toBeNull()
  })
  it("on play() rejection (iOS NotAllowedError): pill switches to 'Tap to Unmute' (visually distinct)", async () => {
    // Override the mocked play() to reject, simulating iOS unmute-with-no-gesture.
    mockPlayerRef.current = makeTestPlayer({
      play: vi.fn(() => Promise.reject(new Error("NotAllowedError"))),
    })

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
  it("does not render the spinner during the poster-only initial state", () => {
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).toBeNull()
  })

  it("does not render the spinner during muted preview activation", async () => {
    await activateMutedPreviewFromIdle()
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="watch-player-loading-indicator"]'),
    ).toBeNull()
  })

  it("removes the spinner once onCanPlay fires", async () => {
    await activateMutedPreviewFromIdle()
    await fireCanPlay()
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).toBeNull()
  })

  it("shows the spinner when committed playback buffers", async () => {
    setSearchParams("autoplay=1")
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    await fireCanPlay()
    await firePlaying()
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).toBeNull()

    await fireWaiting()
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="watch-player-loading-indicator"]'),
    ).not.toBeNull()

    await fireSeeked()
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).toBeNull()
  })

  it("removes the spinner on a non-autoplay-blocked error so Mux's own error UI is visible", async () => {
    // F1 verification: a network/decode/manifest error never fires onCanPlay,
    // so without this fallback the spinner sits over a black box forever.
    await activateMutedPreviewFromIdle()
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).toBeNull()
    await fireError("manifest-load-error")
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="hero-player-poster-layer"]')
        ?.className,
    ).toContain("opacity-0")
  })

  it("keeps the spinner hidden when muted preview autoplay is blocked", async () => {
    await activateMutedPreviewFromIdle()
    await fireError("autoplay-blocked")
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).toBeNull()
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
// volume slider mute/unmute heuristics, and the auto-dim timer lifecycle.
// ---------------------------------------------------------------------------

async function revealChrome(block = makeBlock()): Promise<void> {
  act(() => {
    root.render(<HeroPlayer block={block} />)
  })
  const pill = container.querySelector(
    '[data-testid="hero-player-unmute-pill"]',
  ) as HTMLButtonElement
  await act(async () => {
    pill.click()
  })
}

describe("HeroPlayer — custom chrome render", () => {
  it("renders the full chrome element set after Watch now", async () => {
    await revealChrome()
    expect(
      container.querySelector('[data-testid="hero-player-custom-chrome"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="hero-player-click-surface"]'),
    ).not.toBeNull()
    const clickSurface = container.querySelector(
      '[data-testid="hero-player-click-surface"]',
    ) as HTMLButtonElement
    expect(clickSurface.className).toContain("cursor-default")
    expect(clickSurface.className).not.toContain("cursor-none")
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

  it("uses the full-width watch rail layout for the chrome bar", async () => {
    await revealChrome()
    const chrome = container.querySelector(
      '[data-testid="hero-player-custom-chrome"]',
    ) as HTMLElement

    expect(chrome.className).toContain("inset-x-0")
    expect(chrome.className).toContain("w-full")
    expect(chrome.className).toContain("flex-wrap")
    expect(chrome.className).toContain("gap-x-2")
    expect(chrome.className).toContain("gap-y-0")
    expect(chrome.className).toContain("pb-3")
    expect(chrome.className).toContain("md:flex-nowrap")
    expect(chrome.className).toContain("md:gap-x-4")
    expect(chrome.className).toContain("md:pb-7")
    expect(chrome.className).toContain("px-5")
    expect(chrome.className).toContain("md:px-16")
    expect(chrome.className).toContain("xl:px-24")
  })

  it("puts the timeline above the button row on mobile", async () => {
    await revealChrome()
    const timeline = container.querySelector(
      '[data-testid="hero-chrome-timeline"]',
    ) as HTMLElement
    const spacer = container.querySelector(
      '[data-testid="hero-chrome-mobile-spacer"]',
    ) as HTMLElement

    expect(timeline.className).toContain("relative")
    expect(timeline.className).toContain("order-first")
    expect(timeline.className).toContain("h-5")
    expect(timeline.className).toContain("basis-full")
    expect(timeline.className).toContain("md:order-none")
    expect(timeline.className).toContain("md:h-8")
    expect(timeline.className).toContain("md:basis-auto")
    expect(spacer.className).toContain("flex-1")
    expect(spacer.className).toContain("md:hidden")
  })

  it("uses a subtle focus-visible treatment for the timeline instead of the white glow", async () => {
    await revealChrome()
    const timeline = container.querySelector(
      '[data-testid="hero-chrome-timeline"]',
    ) as HTMLElement

    expect(timeline.className).not.toContain("focus:ring-2")
    expect(timeline.className).not.toContain("focus:ring-white/60")
    expect(timeline.className).toContain("focus-visible:outline-none")
    expect(timeline.innerHTML).toContain("group-focus-visible/timeline:ring")
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

  it("click-surface still toggles pause/play after the user mutes committed playback", async () => {
    await revealChrome()
    if (mockPlayerRef.current) {
      mockPlayerRef.current.paused = false
      mockPlayerRef.current.muted = true
      mockPlayerRef.current.currentTime = 18
      mockPlayerRef.current.pause.mockClear()
      mockPlayerRef.current.play.mockClear()
    }

    const surface = container.querySelector(
      '[data-testid="hero-player-click-surface"]',
    ) as HTMLButtonElement
    await act(async () => {
      surface.click()
    })

    expect(mockPlayerRef.current?.pause).toHaveBeenCalledTimes(1)
    expect(mockPlayerRef.current?.play).not.toHaveBeenCalled()
    expect(mockPlayerRef.current?.muted).toBe(true)
    expect(mockPlayerRef.current?.currentTime).toBe(18)
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

describe("HeroPlayer — fade timer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts fully visible, ignores pointer movement for 5s, then video mouse movement wakes the rail", async () => {
    await revealChrome()
    if (mockPlayerRef.current) mockPlayerRef.current.paused = false
    const chrome = container.querySelector(
      '[data-testid="hero-player-custom-chrome"]',
    ) as HTMLElement
    expect(chrome.getAttribute("data-visible")).toBe("true")
    expect(chrome.getAttribute("data-bright")).toBe("false")
    expect(chrome.getAttribute("data-visibility")).toBe("dim")
    expect(chrome.className).toContain("opacity-100")

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent("pointermove", {
          clientX: 100,
          clientY: 100,
        }),
      )
      window.dispatchEvent(
        new MouseEvent("pointermove", {
          clientX: 124,
          clientY: 100,
        }),
      )
    })

    expect(chrome.getAttribute("data-bright")).toBe("false")
    expect(chrome.getAttribute("data-visibility")).toBe("dim")
    expect(chrome.className).toContain("opacity-100")

    await act(async () => {
      chrome.dispatchEvent(makePointerEvent("pointermove"))
    })

    expect(chrome.getAttribute("data-bright")).toBe("false")
    expect(chrome.getAttribute("data-visibility")).toBe("dim")
    expect(chrome.className).toContain("opacity-100")

    await act(async () => {
      vi.advanceTimersByTime(5001)
    })

    expect(chrome.getAttribute("data-visible")).toBe("false")
    expect(chrome.getAttribute("data-visibility")).toBe("hidden")
    expect(chrome.className).toContain("opacity-0")

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent("pointermove", {
          clientX: 100,
          clientY: 100,
        }),
      )
    })

    expect(chrome.getAttribute("data-visible")).toBe("true")
    expect(chrome.getAttribute("data-bright")).toBe("false")
    expect(chrome.getAttribute("data-visibility")).toBe("dim")
    expect(chrome.className).toContain("opacity-100")

    await act(async () => {
      chrome.dispatchEvent(makePointerEvent("pointermove"))
    })

    expect(chrome.getAttribute("data-visible")).toBe("true")
    expect(chrome.getAttribute("data-bright")).toBe("true")
    expect(chrome.getAttribute("data-visibility")).toBe("bright")
    expect(chrome.className).toContain("opacity-100")

    await act(async () => {
      chrome.dispatchEvent(makePointerEvent("pointerout"))
    })

    await act(async () => {
      vi.advanceTimersByTime(4001)
    })

    expect(chrome.getAttribute("data-visible")).toBe("false")
    expect(chrome.getAttribute("data-bright")).toBe("false")
    expect(chrome.getAttribute("data-visibility")).toBe("hidden")
    expect(chrome.className).toContain("opacity-0")
  })

  it("keeps the top language button mounted during the visible grace state and publishes hidden opacity after 5s", async () => {
    const visibilityEvents: WatchPlayerChromeVisibilityDetail[] = []
    const languageEvents: WatchHeaderLanguageSwitcherDetail[] = []
    const onVisibility = (event: Event) => {
      visibilityEvents.push(
        (event as CustomEvent<WatchPlayerChromeVisibilityDetail>).detail,
      )
    }
    const onLanguageSwitcher = (event: Event) => {
      languageEvents.push(
        (event as CustomEvent<WatchHeaderLanguageSwitcherDetail>).detail,
      )
    }
    window.addEventListener(WATCH_PLAYER_CHROME_VISIBILITY_EVENT, onVisibility)
    window.addEventListener(
      WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
      onLanguageSwitcher,
    )

    try {
      act(() => {
        root.render(
          <HeroPlayer
            block={makeBlock()}
            onLanguageClick={() => {}}
            playableLanguageCount={2}
          />,
        )
      })
      const pill = container.querySelector(
        '[data-testid="hero-player-unmute-pill"]',
      ) as HTMLButtonElement
      await act(async () => {
        pill.click()
      })

      expect(languageEvents.at(-1)?.visible).toBe(true)
      expect(visibilityEvents.some((event) => event.opacity === 1)).toBe(true)

      await act(async () => {
        vi.advanceTimersByTime(5001)
      })

      expect(
        container
          .querySelector('[data-testid="hero-player-custom-chrome"]')
          ?.getAttribute("data-visibility"),
      ).toBe("hidden")
      expect(languageEvents.at(-1)?.visible).toBe(true)
      expect(visibilityEvents.at(-1)?.opacity).toBe(0)
    } finally {
      window.removeEventListener(
        WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
        onVisibility,
      )
      window.removeEventListener(
        WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
        onLanguageSwitcher,
      )
    }
  })

  it("brightens controls and header visibility when scrolling back to the very top", async () => {
    const visibilityEvents: WatchPlayerChromeVisibilityDetail[] = []
    const languageEvents: WatchHeaderLanguageSwitcherDetail[] = []
    const onVisibility = (event: Event) => {
      visibilityEvents.push(
        (event as CustomEvent<WatchPlayerChromeVisibilityDetail>).detail,
      )
    }
    const onLanguageSwitcher = (event: Event) => {
      languageEvents.push(
        (event as CustomEvent<WatchHeaderLanguageSwitcherDetail>).detail,
      )
    }
    window.addEventListener(WATCH_PLAYER_CHROME_VISIBILITY_EVENT, onVisibility)
    window.addEventListener(
      WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
      onLanguageSwitcher,
    )

    try {
      act(() => {
        root.render(
          <HeroPlayer
            block={makeBlock()}
            onLanguageClick={() => {}}
            playableLanguageCount={2}
          />,
        )
      })
      const pill = container.querySelector(
        '[data-testid="hero-player-unmute-pill"]',
      ) as HTMLButtonElement
      await act(async () => {
        pill.click()
      })

      await act(async () => {
        vi.advanceTimersByTime(5001)
      })

      const chrome = container.querySelector(
        '[data-testid="hero-player-custom-chrome"]',
      )
      expect(chrome?.getAttribute("data-visibility")).toBe("hidden")
      expect(languageEvents.at(-1)?.visible).toBe(true)

      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 0,
      })
      await act(async () => {
        window.dispatchEvent(new Event("scroll"))
      })

      expect(chrome?.getAttribute("data-bright")).toBe("true")
      expect(chrome?.getAttribute("data-visibility")).toBe("bright")
      expect(languageEvents.at(-1)?.visible).toBe(true)
      expect(visibilityEvents.some((event) => event.opacity === 0)).toBe(true)
      expect(visibilityEvents.at(-1)?.opacity).toBe(1)
    } finally {
      window.removeEventListener(
        WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
        onVisibility,
      )
      window.removeEventListener(
        WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
        onLanguageSwitcher,
      )
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 0,
      })
    }
  })

  it("ignores controls hover during the 5s lockout, then reveals and does not hide while hovered", async () => {
    await revealChrome()
    const chrome = container.querySelector(
      '[data-testid="hero-player-custom-chrome"]',
    ) as HTMLElement

    await act(async () => {
      chrome.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
    })

    expect(chrome.getAttribute("data-visibility")).toBe("dim")
    expect(chrome.className).toContain("opacity-100")

    await act(async () => {
      vi.advanceTimersByTime(5001)
    })

    expect(chrome.getAttribute("data-visibility")).toBe("hidden")

    await act(async () => {
      chrome.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
    })

    expect(chrome.getAttribute("data-visibility")).toBe("bright")
    expect(chrome.className).toContain("opacity-100")

    await act(async () => {
      vi.advanceTimersByTime(4001)
    })

    expect(chrome.getAttribute("data-visibility")).toBe("bright")

    await act(async () => {
      chrome.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }))
    })
    await act(async () => {
      vi.advanceTimersByTime(4001)
    })

    expect(chrome.getAttribute("data-visibility")).toBe("hidden")
    expect(chrome.className).toContain("opacity-0")
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

// ---------------------------------------------------------------------------
// Pause-on-scroll-past-hero. The hero wrapper is sticky and its bounding
// rect never actually leaves the viewport (the body content slides over
// it). So we pause based on scroll position vs. measured hero height
// rather than IntersectionObserver. Applies to BOTH states (pre-reveal
// muted loop AND post-reveal committed playback); on scroll-back we
// auto-resume only the muted preview.
// ---------------------------------------------------------------------------

// Install a ResizeObserver stub that lets us drive heroHeight from tests
// (jsdom has no RO; the component falls back to getBoundingClientRect
// which returns 0 in jsdom, leaving heroHeight=null and the scroll
// effect inert). Returns a "set" helper that fires the RO callback with
// the supplied height.
function installResizeObserverStub(): {
  setHeight: (h: number) => Promise<void>
  restore: () => void
} {
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
  const slot = globalThis as { ResizeObserver?: typeof ResizeObserver }
  const original = slot.ResizeObserver
  slot.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
  return {
    setHeight: async (h: number) => {
      const cb = callbacks[callbacks.length - 1]
      if (!cb) return
      await act(async () => {
        cb(
          [{ contentRect: { height: h } } as ResizeObserverEntry],
          {} as ResizeObserver,
        )
      })
    },
    restore: () => {
      if (original) {
        slot.ResizeObserver = original
      } else {
        delete slot.ResizeObserver
      }
    },
  }
}

// Drive scroll: set window.scrollY, dispatch the event, then flush the
// rAF tick the component throttles on. We use fake timers because the
// component's rAF (polyfilled as setTimeout(0) by vitest.setup.ts) needs
// to be drained deterministically — without fake timers + runAllTimers,
// the scroll handler enqueues a task but the test's microtask awaits
// don't always pump it through before assertions.
async function scrollTo(y: number): Promise<void> {
  Object.defineProperty(window, "scrollY", {
    value: y,
    configurable: true,
    writable: true,
  })
  await act(async () => {
    window.dispatchEvent(new Event("scroll"))
    await vi.runAllTimersAsync()
  })
}

describe("HeroPlayer — pause when scrolled past the hero", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("pauses the muted-loop preview when scrollY exceeds the measured hero height", async () => {
    const ro = installResizeObserverStub()
    try {
      act(() => {
        root.render(<HeroPlayer block={makeBlock()} />)
      })
      await ro.setHeight(1072)
      if (mockPlayerRef.current) {
        mockPlayerRef.current.paused = false
        mockPlayerRef.current.pause.mockClear()
      }
      await scrollTo(1500)
      expect(mockPlayerRef.current?.pause).toHaveBeenCalledTimes(1)
    } finally {
      ro.restore()
    }
  })

  it("auto-resumes the muted preview when scrolling back to the top (pre-reveal only)", async () => {
    const ro = installResizeObserverStub()
    try {
      act(() => {
        root.render(<HeroPlayer block={makeBlock()} />)
      })
      await ro.setHeight(1072)
      // Simulate a prior scroll-past pause.
      await scrollTo(1500)
      if (mockPlayerRef.current) {
        mockPlayerRef.current.paused = true
        mockPlayerRef.current.play.mockClear()
      }
      await scrollTo(0)
      expect(mockPlayerRef.current?.play).toHaveBeenCalledTimes(1)
    } finally {
      ro.restore()
    }
  })

  it("pauses post-reveal playback when scrolled past the hero", async () => {
    const ro = installResizeObserverStub()
    try {
      await revealChrome()
      await ro.setHeight(1072)
      if (mockPlayerRef.current) {
        mockPlayerRef.current.paused = false
        mockPlayerRef.current.pause.mockClear()
      }
      await scrollTo(1500)
      expect(mockPlayerRef.current?.pause).toHaveBeenCalledTimes(1)
    } finally {
      ro.restore()
    }
  })

  it("auto-resumes post-reveal playback when scrolling back to the hero", async () => {
    const ro = installResizeObserverStub()
    try {
      await revealChrome()
      await ro.setHeight(1072)
      await scrollTo(1500)
      if (mockPlayerRef.current) {
        // Simulate the pause having taken effect.
        mockPlayerRef.current.paused = true
        mockPlayerRef.current.play.mockClear()
      }
      await scrollTo(0)
      // Symmetric resume — when the hero is the main element on screen
      // again, playback should pick up where it left off in both states.
      expect(mockPlayerRef.current?.play).toHaveBeenCalledTimes(1)
    } finally {
      ro.restore()
    }
  })

  it("does NOT auto-resume on scroll-back when the user manually paused before scrolling away", async () => {
    const ro = installResizeObserverStub()
    try {
      await revealChrome()
      await ro.setHeight(1072)
      // Simulate a user-initiated pause (chrome button / keyboard) BEFORE
      // any scroll happens. The scroll listener must not claim this pause
      // and must not auto-resume on scroll-back.
      if (mockPlayerRef.current) {
        mockPlayerRef.current.paused = true
        mockPlayerRef.current.pause.mockClear()
        mockPlayerRef.current.play.mockClear()
      }
      await scrollTo(1500)
      // We did not call pause — player was already paused.
      expect(mockPlayerRef.current?.pause).not.toHaveBeenCalled()
      await scrollTo(0)
      // And we must NOT auto-resume because we never claimed the pause.
      expect(mockPlayerRef.current?.play).not.toHaveBeenCalled()
    } finally {
      ro.restore()
    }
  })

  it("does not pause when the scroll is still within the hero (covered transition not reached)", async () => {
    const ro = installResizeObserverStub()
    try {
      act(() => {
        root.render(<HeroPlayer block={makeBlock()} />)
      })
      await ro.setHeight(1072)
      if (mockPlayerRef.current) {
        mockPlayerRef.current.paused = false
        mockPlayerRef.current.pause.mockClear()
      }
      // scrollY < heroHeight — body has only started to enter the viewport.
      await scrollTo(500)
      expect(mockPlayerRef.current?.pause).not.toHaveBeenCalled()
    } finally {
      ro.restore()
    }
  })

  it("pauses at the 60% obscured threshold, not at 100%", async () => {
    // Pin viewport to a known size so the threshold math is deterministic.
    // With heroHeight=1000 and viewport=800, visibleVideoHeight=800; the
    // 60% threshold means body must cover >=480px of the 800px visible
    // video, i.e. scrollY >= 1000 - (0.4 * 800) = 680.
    const originalInnerHeight = window.innerHeight
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    })
    const ro = installResizeObserverStub()
    try {
      act(() => {
        root.render(<HeroPlayer block={makeBlock()} />)
      })
      await ro.setHeight(1000)
      if (mockPlayerRef.current) {
        mockPlayerRef.current.paused = false
        mockPlayerRef.current.pause.mockClear()
      }
      // 50% obscured (scrollY=600 → unobscured=400, fraction=0.5).
      // Should NOT pause.
      await scrollTo(600)
      expect(mockPlayerRef.current?.pause).not.toHaveBeenCalled()
      // 70% obscured (scrollY=760 → unobscured=240, fraction=0.7).
      // Should pause.
      await scrollTo(760)
      expect(mockPlayerRef.current?.pause).toHaveBeenCalledTimes(1)
    } finally {
      ro.restore()
      Object.defineProperty(window, "innerHeight", {
        value: originalInnerHeight,
        configurable: true,
      })
    }
  })

  it("uses the measured body zone top when deciding whether the body covers the video", async () => {
    const originalInnerHeight = window.innerHeight
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    })
    const bodyZone = document.createElement("section")
    bodyZone.dataset.testid = "watch-body-zone"
    bodyZone.getBoundingClientRect = vi.fn(
      () =>
        ({
          top: 280,
          bottom: 1000,
          height: 720,
          left: 0,
          right: 1200,
          width: 1200,
          x: 0,
          y: 280,
          toJSON: () => ({}),
        }) as DOMRect,
    )
    document.body.appendChild(bodyZone)
    const ro = installResizeObserverStub()
    try {
      act(() => {
        root.render(<HeroPlayer block={makeBlock()} />)
      })
      await ro.setHeight(1000)
      if (mockPlayerRef.current) {
        mockPlayerRef.current.paused = false
        mockPlayerRef.current.pause.mockClear()
      }
      // Fallback math at scrollY=0 would not pause, but the measured body
      // top says 520px of the 800px visible video is covered.
      await scrollTo(0)
      expect(mockPlayerRef.current?.pause).toHaveBeenCalledTimes(1)
    } finally {
      ro.restore()
      bodyZone.remove()
      Object.defineProperty(window, "innerHeight", {
        value: originalInnerHeight,
        configurable: true,
      })
    }
  })

  it("pins the exact 60% boundary: scrollY=680 pauses, scrollY=679 does not", async () => {
    // Boundary value pins the >= comparison and the OBSCURED_PAUSE_THRESHOLD
    // constant at 0.6. With heroHeight=1000, viewport=800, the exact threshold
    // scrollY is 680. One pixel below must NOT pause; the threshold itself must.
    const originalInnerHeight = window.innerHeight
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    })
    const ro = installResizeObserverStub()
    try {
      act(() => {
        root.render(<HeroPlayer block={makeBlock()} />)
      })
      await ro.setHeight(1000)
      if (mockPlayerRef.current) {
        mockPlayerRef.current.paused = false
        mockPlayerRef.current.pause.mockClear()
      }
      // Just below the threshold — must NOT pause.
      await scrollTo(679)
      expect(mockPlayerRef.current?.pause).not.toHaveBeenCalled()
      // At the threshold (>=) — must pause.
      await scrollTo(680)
      expect(mockPlayerRef.current?.pause).toHaveBeenCalledTimes(1)
    } finally {
      ro.restore()
      Object.defineProperty(window, "innerHeight", {
        value: originalInnerHeight,
        configurable: true,
      })
    }
  })
})

describe("HeroPlayer — sticky-hero / portal layout", () => {
  it("portals the chrome bar AND the backdrop into the overlay anchor, not the sticky hero wrapper", async () => {
    await revealChrome()
    const chrome = container.querySelector(
      '[data-testid="hero-player-custom-chrome"]',
    )
    const backdrop = container.querySelector(
      '[data-testid="hero-player-chrome-backdrop"]',
    )
    const anchor = container.querySelector(
      '[data-testid="hero-player-overlay-anchor"]',
    )
    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    )
    expect(chrome).not.toBeNull()
    expect(backdrop).not.toBeNull()
    expect(anchor).not.toBeNull()
    expect(wrapper).not.toBeNull()
    expect(anchor?.className).toContain("max-w-[1920px]")
    expect(wrapper?.className).not.toContain("max-w-[1920px]")
    // Portal target — chrome bar AND its backing gradient live under the
    // zero-height anchor that scrolls with the body section, not under
    // the sticky hero wrapper. Backdrop must travel with the chrome so
    // the controls stay legible at every scroll position.
    expect(anchor!.contains(chrome!)).toBe(true)
    expect(wrapper!.contains(chrome!)).toBe(false)
    expect(anchor!.contains(backdrop!)).toBe(true)
    expect(wrapper!.contains(backdrop!)).toBe(false)
  })

  it("tap-to-unmute branch calls play() without resetting currentTime", async () => {
    // mockPlayerRef.current is null until the muxVideoMock factory runs
    // during render — so we have to render first, then swap play() to
    // reject (driving the pill into 'tap-to-unmute' state on click 1).
    mockPlayerRef.current = makeTestPlayer({
      play: vi.fn(() => Promise.reject(new Error("NotAllowedError"))),
    })

    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

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

function stubTimelineRect({
  height = 1,
  top = 0,
}: {
  height?: number
  top?: number
} = {}): HTMLDivElement {
  const tl = container.querySelector(
    '[data-testid="hero-chrome-timeline"]',
  ) as HTMLDivElement
  Object.defineProperty(tl, "getBoundingClientRect", {
    value: () =>
      ({
        x: 0,
        y: top,
        top,
        left: 0,
        right: 100,
        bottom: top + height,
        width: 100,
        height,
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
  init: { clientX?: number; clientY?: number; pointerId?: number } = {},
): PointerEvent {
  // JSDOM lacks PointerEvent; fall back to MouseEvent + manual fields.
  const Ctor =
    typeof PointerEvent === "function" ? PointerEvent : (MouseEvent as never)
  const evt = new Ctor(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  }) as PointerEvent
  Object.defineProperty(evt, "pointerId", {
    value: init.pointerId ?? 1,
    configurable: true,
  })
  return evt
}

function installStoryboardFetchMock(
  storyboard = {
    url: "https://image.mux.com/playback-id-123/storyboard.webp",
    tile_width: 256,
    tile_height: 160,
    duration: 60,
    tiles: [
      { start: 0, x: 0, y: 0 },
      { start: 20, x: 256, y: 0 },
      { start: 40, x: 512, y: 0 },
    ],
  },
) {
  const originalFetch = globalThis.fetch
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(storyboard),
    } as Response),
  )
  globalThis.fetch = fetchMock as typeof fetch
  return {
    fetchMock,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("HeroPlayer — timeline storyboard previews", () => {
  it("does not request storyboard metadata before chrome reveal", () => {
    const { fetchMock, restore } = installStoryboardFetchMock()
    try {
      act(() => {
        root.render(<HeroPlayer block={makeBlock()} />)
      })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it("requests storyboard metadata after chrome reveal when playbackId is available", async () => {
    const { fetchMock, restore } = installStoryboardFetchMock()
    try {
      await revealChrome()
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledWith(
        "https://image.mux.com/playback-id-123/storyboard.json?format=webp",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    } finally {
      restore()
    }
  })

  it("does not request storyboard metadata without a playbackId", async () => {
    const { fetchMock, restore } = installStoryboardFetchMock()
    try {
      await revealChrome(makeBlock({ playbackId: null }))
      await flushPromises()
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it("shows the preview when hovering inside the expanded timeline hit area", async () => {
    const { restore } = installStoryboardFetchMock()
    try {
      await revealChrome()
      await flushPromises()
      const tl = stubTimelineRect({ height: 32, top: 100 })
      await act(async () => {
        tl.dispatchEvent(
          makePointerEvent("pointermove", { clientX: 50, clientY: 110 }),
        )
      })

      const preview = container.querySelector(
        '[data-testid="hero-chrome-timeline-preview"]',
      ) as HTMLElement
      expect(preview).not.toBeNull()
      expect(preview.getAttribute("style")).toContain(
        "--hero-preview-left: clamp(64px, 50%, calc(100% - 64px))",
      )
      expect(preview.style.left).toBe("var(--hero-preview-left)")
      expect(
        preview.querySelector("[aria-hidden]")?.getAttribute("style"),
      ).toContain("background-position: -256px 0px")
      expect(preview.className).not.toContain("bg-black")
      const previewTime = container.querySelector(
        '[data-testid="hero-chrome-timeline-preview-time"]',
      )
      expect(previewTime?.className).toContain("right-1 bottom-1")
      expect(previewTime?.className).toContain("bg-black/65")
      expect(previewTime?.textContent).toBe("0:30")
    } finally {
      restore()
    }
  })

  it("boxes the preview within the timeline edges", async () => {
    const { restore } = installStoryboardFetchMock()
    try {
      await revealChrome()
      await flushPromises()
      const tl = stubTimelineRect({ height: 32, top: 100 })

      await act(async () => {
        tl.dispatchEvent(
          makePointerEvent("pointermove", { clientX: 0, clientY: 110 }),
        )
      })
      let preview = container.querySelector(
        '[data-testid="hero-chrome-timeline-preview"]',
      ) as HTMLElement
      expect(preview.getAttribute("style")).toContain(
        "--hero-preview-left: clamp(64px, 4%, calc(100% - 64px))",
      )

      await act(async () => {
        tl.dispatchEvent(
          makePointerEvent("pointermove", { clientX: 100, clientY: 110 }),
        )
      })
      preview = container.querySelector(
        '[data-testid="hero-chrome-timeline-preview"]',
      ) as HTMLElement
      expect(preview.getAttribute("style")).toContain(
        "--hero-preview-left: clamp(64px, 96%, calc(100% - 64px))",
      )
    } finally {
      restore()
    }
  })
})

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

  it("keeps the released scrub target visible while media time catches up", async () => {
    await revealChrome()
    if (mockPlayerRef.current) {
      mockPlayerRef.current.duration = 60
      mockPlayerRef.current.currentTime = 10
      mockPlayerRef.current.paused = false
    }
    const tl = stubTimelineRect()
    await act(async () => {
      tl.dispatchEvent(makePointerEvent("pointerdown", { clientX: 75 }))
    })
    if (mockPlayerRef.current) {
      mockPlayerRef.current.currentTime = 10
    }
    await act(async () => {
      tl.dispatchEvent(makePointerEvent("pointerup", { clientX: 75 }))
    })
    const time = container.querySelector(
      '[data-testid="hero-chrome-time"]',
    ) as HTMLElement
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

// ---------------------------------------------------------------------------
// Language switch button (Task 4 — globe overlay).
// Render-shape only: the button is conditional on a valid `onLanguageClick`
// callback AND `playableLanguageCount >= 2`. Wiring into WatchSectionRenderer
// is Task 5 and out of scope here.
// ---------------------------------------------------------------------------

describe("HeroPlayer — language switch button", () => {
  function listenForLanguageSwitcher() {
    const updates: WatchHeaderLanguageSwitcherDetail[] = []
    const handler = (event: Event) => {
      updates.push(
        (event as CustomEvent<WatchHeaderLanguageSwitcherDetail>).detail,
      )
    }
    window.addEventListener(WATCH_HEADER_LANGUAGE_SWITCHER_EVENT, handler)
    return {
      updates,
      cleanup: () =>
        window.removeEventListener(
          WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
          handler,
        ),
    }
  }

  it("does not render when playableLanguageCount < 2", () => {
    const onLanguageClick = vi.fn()
    const listener = listenForLanguageSwitcher()
    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock()}
          onLanguageClick={onLanguageClick}
          playableLanguageCount={1}
        />,
      )
    })
    expect(listener.updates.at(-1)?.visible).toBe(false)
    listener.cleanup()
  })

  it("publishes a header language switcher when playableLanguageCount >= 2 with onLanguageClick", () => {
    const onLanguageClick = vi.fn()
    const listener = listenForLanguageSwitcher()
    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock()}
          onLanguageClick={onLanguageClick}
          playableLanguageCount={2}
        />,
      )
    })
    const latest = listener.updates.at(-1)
    expect(latest?.visible).toBe(true)
    expect(latest?.onClick).toBe(onLanguageClick)
    expect(latest?.languageCode).toBe("EN")
    latest?.onClick?.()
    expect(onLanguageClick).toHaveBeenCalledTimes(1)
    listener.cleanup()
  })

  it("hides the top-right language button when fullscreen is active", async () => {
    const onLanguageClick = vi.fn()
    const listener = listenForLanguageSwitcher()
    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock()}
          onLanguageClick={onLanguageClick}
          playableLanguageCount={2}
        />,
      )
    })
    // Initially visible (no fullscreen)
    expect(listener.updates.at(-1)?.visible).toBe(true)

    // Enter fullscreen
    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    )
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get() {
        return wrapper
      },
    })
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"))
    })

    expect(listener.updates.at(-1)?.visible).toBe(false)

    // Reset jsdom state for subsequent tests
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get() {
        return null
      },
    })
    listener.cleanup()
  })
})

describe("HeroPlayer — autoplay on ?autoplay=1", () => {
  // The effect signals language-switch arrivals: fired by LanguagePickerModal
  // Apply, consumed here as a one-shot unmuted play attempt. Each test sets
  // the URL params before render, fires onCanPlay to satisfy videoReady,
  // and waits a tick so the post-then setState commits.

  async function nextTick() {
    await act(async () => {
      await Promise.resolve()
    })
  }

  it("uses the compact playback frame on the first autoplay render", () => {
    setSearchParams("autoplay=1")
    const blurDataURL = "data:image/webp;base64,BQYHCA=="
    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock({ muxHeroPosterBlurDataUrl: blurDataURL })}
        />,
      )
    })

    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    ) as HTMLDivElement
    const mediaFrame = container.querySelector(
      '[data-testid="hero-player-media-frame"]',
    ) as HTMLDivElement
    const posterLayer = container.querySelector(
      '[data-testid="hero-player-poster-layer"]',
    )
    const props = lastMuxProps()

    expect(wrapper.getAttribute("data-chrome-revealed")).toBe("false")
    expect(wrapper.getAttribute("data-mobile-portrait-preview")).toBe("false")
    expect(wrapper.className).toContain("overflow-hidden")
    expect(wrapper.className).not.toContain(
      "[@media(max-width:767px)_and_(orientation:portrait)]:h-[100vw]",
    )
    expect(mediaFrame.className).not.toContain(
      "[@media(max-width:767px)_and_(orientation:portrait)]:overflow-hidden",
    )
    expect(posterLayer?.className).toContain("opacity-100")
    expect(props.style).toEqual({ objectFit: "contain" })
    expect(
      container.querySelector('[data-testid="hero-player-loading"]')?.className,
    ).toContain("z-40")
    expect(
      container.querySelector('[data-testid="watch-player-loading-indicator"]'),
    ).not.toBeNull()
  })

  it("attempts unmuted play and reveals chrome when ?autoplay=1 is set and play resolves", async () => {
    setSearchParams("autoplay=1")
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })
    expect(
      container.querySelector('[data-testid="hero-player-poster-layer"]')
        ?.className,
    ).toContain("opacity-100")
    expect(
      container.querySelector('[data-testid="hero-player-unmute-pill"]'),
    ).toBeNull()
    await fireCanPlay()
    // play() default mock returns Promise.resolve() — wait for the .then
    // microtask so setChromeRevealed commits.
    await nextTick()
    await nextTick()

    const player = mockPlayerRef.current!
    expect(player.play).toHaveBeenCalled()
    expect(player.muted).toBe(false)
    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    )
    expect(wrapper?.getAttribute("data-chrome-revealed")).toBe("true")
  })

  it("leaves the player muted when play() rejects (no MEI grant)", async () => {
    setSearchParams("autoplay=1")
    // Re-prime the player factory: install a play() that rejects on the
    // FIRST call only (the autoplay attempt). Subsequent calls (e.g. the
    // unmute pill click) resolve normally.
    muxVideoMock.mockImplementationOnce((props) => {
      const { ref } = props
      const player = {
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
      }
      mockPlayerRef.current = player as unknown as typeof mockPlayerRef.current
      useImperativeHandle(ref as React.RefObject<unknown>, () => player)
      return null
    })
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })
    await fireCanPlay()
    await nextTick()
    await nextTick()

    const player = mockPlayerRef.current!
    expect(player.play).toHaveBeenCalled()
    // muted stays true because we set muted=false only inside .then() so
    // the rejection path leaves the player in the safe muted state.
    expect(player.muted).toBe(true)
    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    )
    expect(wrapper?.getAttribute("data-chrome-revealed")).toBe("false")
    expect(
      container.querySelector('[data-testid="hero-player-unmute-pill"]'),
    ).not.toBeNull()
  })

  it("is a no-op when ?autoplay=1 is absent (no play attempt, player stays muted)", async () => {
    // mockSearchParams default = empty
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })
    await nextTick()

    expect(muxVideoMock).not.toHaveBeenCalled()
    expect(mockPlayerRef.current).toBeNull()
  })

  it("strips ?autoplay=1 from the URL after the attempt (refresh-safe)", async () => {
    setSearchParams("autoplay=1")
    // Seed window.location.search so the effect's `new URL(...)` read
    // sees the param to strip. jsdom keeps useSearchParams (mocked) and
    // window.location independent, so we set both for the test.
    window.history.replaceState(null, "", "/jesus/spanish?autoplay=1&t=42")
    const replaceStateSpy = vi.spyOn(window.history, "replaceState")
    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })
    await fireCanPlay()
    await nextTick()

    // replaceState should be called with a URL that does NOT contain
    // autoplay=1. Other params (e.g. ?t=42) survive — we only strip the
    // one-shot autoplay signal.
    expect(replaceStateSpy).toHaveBeenCalled()
    const replacedUrl = replaceStateSpy.mock.calls[0]?.[2] as string
    expect(replacedUrl).not.toContain("autoplay=1")
    expect(replacedUrl).toContain("t=42")
    replaceStateSpy.mockRestore()
    // Reset jsdom URL state for subsequent tests.
    window.history.replaceState(null, "", "/")
  })
})

describe("HeroPlayer — MuxVideo backend events", () => {
  it("flips videoReady via onCanPlay without showing a muted-preview spinner", async () => {
    await activateMutedPreviewFromIdle()
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).toBeNull()

    const handler = lastMuxProps()?.onCanPlay
    await act(async () => {
      handler?.(new Event("canplay"))
    })

    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).toBeNull()
  })

  it("marks autoplayBlocked when play() rejects with NotAllowedError", async () => {
    // Replace the singleton ref's play() with a Promise rejection
    // matching what the browser raises when autoplay-muted is blocked.
    const notAllowed = Object.assign(new Error("NotAllowedError"), {
      name: "NotAllowedError",
    })

    // Drive the ?autoplay=1 path which re-invokes play() after canPlay —
    // this is the same surface the LanguagePickerModal navigation hits.
    setSearchParams("autoplay=1")

    act(() => {
      root.render(<HeroPlayer block={makeBlock()} />)
    })

    if (mockPlayerRef.current) {
      mockPlayerRef.current.play = vi.fn(() => Promise.reject(notAllowed))
    }

    const handler = lastMuxProps()?.onCanPlay
    await act(async () => {
      handler?.(new Event("canplay"))
    })
    // Allow the play() rejection chain to settle.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    )
    expect(wrapper?.getAttribute("data-autoplay-blocked")).toBe("true")
  })

  it("treats a generic onError event as a videoReady fallback (no autoplay-blocked flag)", async () => {
    await activateMutedPreviewFromIdle()

    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).toBeNull()

    const handler = lastMuxProps()?.onError
    await act(async () => {
      handler?.(new Event("error"))
    })

    // videoReady = true but autoplayBlocked stays false because no
    // `detail.code === "autoplay-blocked"` is present and no play()
    // rejection has fired on this surface.
    expect(
      container.querySelector('[data-testid="hero-player-loading"]'),
    ).toBeNull()
    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    )
    expect(wrapper?.getAttribute("data-autoplay-blocked")).toBe("false")
  })
})

describe("HeroPlayer — Watch Next countdown", () => {
  const nextWatchItem = {
    parentSlug: "jesus",
    slug: "chapter-two",
    title: "Chapter Two",
    documentId: "video-2",
    kind: "chapter" as const,
  }

  it("shows the Watch Next button in the final five seconds with timed progress", async () => {
    setSearchParams("autoplay=1")
    mockPlayerRef.current = makeTestPlayer({
      currentTime: 20,
      duration: 60,
      paused: false,
      ended: false,
    })

    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock({ nextWatchItem })}
          languageSlug="english"
        />,
      )
    })
    await revealAutoplayPlayer()

    expect(
      container.querySelector('[data-testid="hero-player-watch-next"]'),
    ).toBeNull()

    mockPlayerRef.current.currentTime = 57
    callPlayerListener("timeupdate")

    const button = container.querySelector(
      '[data-testid="hero-player-watch-next"]',
    )
    expect(button?.textContent).toContain("Next Episode")
    expect(button?.getAttribute("aria-label")).toBe("Next Episode")
    expect(button?.getAttribute("data-auto-armed")).toBe("true")
    expect(button?.querySelector("svg")).not.toBeNull()
    expect(
      (
        container.querySelector(
          '[data-testid="hero-player-watch-next-progress"]',
        ) as HTMLElement | null
      )?.style.width,
    ).toBe("40%")
  })

  it("keeps the button visible as a white manual action after surface interaction", async () => {
    setSearchParams("autoplay=1")
    mockPlayerRef.current = makeTestPlayer({
      currentTime: 54,
      duration: 60,
      paused: false,
      ended: false,
    })

    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock({ nextWatchItem })}
          languageSlug="english"
        />,
      )
    })
    await revealAutoplayPlayer()

    mockPlayerRef.current.currentTime = 57
    callPlayerListener("timeupdate")

    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    )
    act(() => {
      wrapper?.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    })
    mockPlayerRef.current.paused = true
    callPlayerListener("pause")

    const button = container.querySelector(
      '[data-testid="hero-player-watch-next"]',
    )
    expect(button?.textContent).toContain("Next Episode")
    expect(button?.getAttribute("data-manual")).toBe("true")
    expect(
      container.querySelector(
        '[data-testid="hero-player-watch-next-progress"]',
      ),
    ).toBeNull()

    mockPlayerRef.current.currentTime = 60
    mockPlayerRef.current.ended = true
    callPlayerListener("ended")

    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it("auto-advances at the end after natural playback crosses the countdown threshold", async () => {
    setSearchParams("autoplay=1")
    mockPlayerRef.current = makeTestPlayer({
      currentTime: 54,
      duration: 60,
      paused: false,
      ended: false,
    })

    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock({
            nextWatchItem: { ...nextWatchItem, kind: "episode" },
          })}
          languageSlug="english"
        />,
      )
    })
    await revealAutoplayPlayer()

    mockPlayerRef.current.currentTime = 57
    callPlayerListener("timeupdate")

    expect(
      container
        .querySelector('[data-testid="hero-player-watch-next"]')
        ?.getAttribute("data-auto-armed"),
    ).toBe("true")

    mockPlayerRef.current.currentTime = 60
    mockPlayerRef.current.ended = true
    callPlayerListener("ended")

    const button = container.querySelector(
      '[data-testid="hero-player-watch-next"]',
    ) as HTMLButtonElement | null
    expect(button?.textContent).toContain("Next Episode")
    expect(mockRouterPush).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/jesus.html/chapter-two/english.html?autoplay=1",
    )
  })

  it("navigates when the armed Watch Next button is clicked", async () => {
    setSearchParams("autoplay=1")
    mockPlayerRef.current = makeTestPlayer({
      currentTime: 54,
      duration: 60,
      paused: false,
      ended: false,
    })

    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock({
            nextWatchItem: { ...nextWatchItem, kind: "episode" },
          })}
          languageSlug="english"
        />,
      )
    })
    await revealAutoplayPlayer()

    mockPlayerRef.current.currentTime = 57
    callPlayerListener("timeupdate")

    const button = container.querySelector(
      '[data-testid="hero-player-watch-next"]',
    ) as HTMLButtonElement | null
    expect(button?.getAttribute("data-auto-armed")).toBe("true")

    act(() => {
      button?.click()
    })

    expect(mockRouterPush).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/jesus.html/chapter-two/english.html?autoplay=1",
    )
  })

  it("cancels auto-advance when portaled chrome is used in the countdown window", async () => {
    setSearchParams("autoplay=1")
    mockPlayerRef.current = makeTestPlayer({
      currentTime: 54,
      duration: 60,
      paused: false,
      ended: false,
    })

    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock({
            nextWatchItem: { ...nextWatchItem, kind: "episode" },
          })}
          languageSlug="english"
        />,
      )
    })
    await revealAutoplayPlayer()

    mockPlayerRef.current.currentTime = 57
    callPlayerListener("timeupdate")

    const playButton = container.querySelector(
      '[data-testid="hero-chrome-play"]',
    )
    act(() => {
      playButton?.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    })

    expect(
      container
        .querySelector('[data-testid="hero-player-watch-next"]')
        ?.getAttribute("data-manual"),
    ).toBe("true")

    mockPlayerRef.current.currentTime = 60
    mockPlayerRef.current.ended = true
    callPlayerListener("ended")

    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it("does not auto-advance when the user seeks into the countdown window", async () => {
    setSearchParams("autoplay=1")
    mockPlayerRef.current = makeTestPlayer({
      currentTime: 20,
      duration: 60,
      paused: false,
      ended: false,
    })

    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock({
            nextWatchItem: { ...nextWatchItem, kind: "episode" },
          })}
          languageSlug="english"
        />,
      )
    })
    await revealAutoplayPlayer()

    callPlayerListener("seeking")
    mockPlayerRef.current.currentTime = 57
    callPlayerListener("seeked")
    callPlayerListener("timeupdate")

    const button = container.querySelector(
      '[data-testid="hero-player-watch-next"]',
    ) as HTMLButtonElement | null
    expect(button?.textContent).toContain("Next Episode")
    expect(button?.getAttribute("data-manual")).toBe("true")
    expect(button?.getAttribute("data-auto-armed")).toBe("false")

    mockPlayerRef.current.currentTime = 60
    mockPlayerRef.current.ended = true
    callPlayerListener("ended")

    expect(mockRouterPush).not.toHaveBeenCalled()

    act(() => {
      button?.click()
    })

    expect(mockRouterPush).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/jesus.html/chapter-two/english.html?autoplay=1",
    )
  })

  it("re-arms auto-advance on a later natural threshold crossing after cancellation", async () => {
    setSearchParams("autoplay=1")
    mockPlayerRef.current = makeTestPlayer({
      currentTime: 54,
      duration: 60,
      paused: false,
      ended: false,
    })

    act(() => {
      root.render(
        <HeroPlayer
          block={makeBlock({
            nextWatchItem: { ...nextWatchItem, kind: "episode" },
          })}
          languageSlug="english"
        />,
      )
    })
    await revealAutoplayPlayer()

    mockPlayerRef.current.currentTime = 57
    callPlayerListener("timeupdate")

    expect(
      container
        .querySelector('[data-testid="hero-player-watch-next"]')
        ?.getAttribute("data-auto-armed"),
    ).toBe("true")

    const wrapper = container.querySelector(
      '[data-testid="hero-player-wrapper"]',
    )
    act(() => {
      wrapper?.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    })

    expect(
      container
        .querySelector('[data-testid="hero-player-watch-next"]')
        ?.getAttribute("data-manual"),
    ).toBe("true")

    callPlayerListener("seeking")
    mockPlayerRef.current.currentTime = 52
    callPlayerListener("seeked")
    callPlayerListener("timeupdate")

    expect(
      container.querySelector('[data-testid="hero-player-watch-next"]'),
    ).toBeNull()

    mockPlayerRef.current.currentTime = 57
    callPlayerListener("timeupdate")

    expect(
      container
        .querySelector('[data-testid="hero-player-watch-next"]')
        ?.getAttribute("data-auto-armed"),
    ).toBe("true")

    mockPlayerRef.current.currentTime = 60
    mockPlayerRef.current.ended = true
    callPlayerListener("ended")

    expect(mockRouterPush).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/jesus.html/chapter-two/english.html?autoplay=1",
    )
  })
})
