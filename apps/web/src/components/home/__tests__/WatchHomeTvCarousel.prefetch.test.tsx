/**
 * @vitest-environment jsdom
 *
 * Pins the hero "Watch Now" action's touch-gated prefetch posture (W-025).
 *
 * The action re-targets on every hero advance, so on a phone an ungated
 * viewport prefetch fetched each slide's page in turn while the intro video
 * was still buffering. `next/link` strips `prefetch` before spreading onto the
 * anchor, so `WatchHomePage.test.tsx` (real Link) cannot see the prop; this
 * file mocks `next/link` to reflect it onto `data-prefetch`.
 */
import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "../../../../messages/en.json"

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: {
    href: string
    prefetch?: boolean
    children: ReactNode
  } & Record<string, unknown>) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}))

vi.mock("@forge/video-player/mux-video", async () => {
  const React = await vi.importActual<typeof import("react")>("react")
  return {
    default: React.forwardRef<
      HTMLVideoElement,
      React.VideoHTMLAttributes<HTMLVideoElement> & {
        disableTracking?: boolean
        _hlsConfig?: Record<string, unknown>
      }
    >(function MockMuxVideo(
      { disableTracking: _disableTracking, _hlsConfig, ...props },
      ref,
    ) {
      return <video ref={ref} {...props} />
    }),
  }
})

import type { WatchHomeHeroSlide } from "@/lib/watch-home"

import { HOVER_CAPABLE_POINTER_QUERY } from "../useTouchGatedPrefetch"
import { WatchHomeTvCarousel } from "../WatchHomeTvCarousel"

const WATCH_NOW = "a[href*='autoplay=1']"

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

/** Answers only the hover-capable query, so a renamed query cannot pass. */
function stubPointer(kind: "touch" | "mouse") {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: kind === "mouse" && query === HOVER_CAPABLE_POINTER_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })),
  )
}

/** jsdom has no PointerEvent constructor; React only reads `pointerType`. */
function pointerEvent(type: string, pointerType: string) {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, "pointerType", { value: pointerType })
  return event
}

function makeSlide(): WatchHomeHeroSlide {
  return {
    id: "card-1",
    sourceId: "1_jf-0-0",
    coreId: "1_jf-0-0",
    title: "Jesus",
    label: "Feature film",
    eyebrow: "Featured",
    // Intro-eligible, so the carousel renders this slide at all.
    videoLabel: "SEGMENT",
    metaLabel: "2:03",
    href: "/jesus.html/english.html",
    imageUrl: "https://cdn.example/jesus.jpg",
    blurDataUrl: null,
    dominantColor: null,
    imageAlt: "Jesus still",
    hls: "https://stream.example/jesus.m3u8",
    playbackId: "mux-1",
    subtitleVttSrc: null,
    subtitleLanguageBcp47: null,
    durationSeconds: 123,
    childCount: 0,
    parentCoreId: null,
    parentSlug: null,
    missingData: [],
  } as WatchHomeHeroSlide
}

function renderCarousel() {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <WatchHomeTvCarousel slides={[makeSlide()]} />
      </NextIntlClientProvider>,
    )
  })
  return container.querySelector<HTMLAnchorElement>(WATCH_NOW)
}

function watchNowPrefetch() {
  return container.querySelector(WATCH_NOW)?.getAttribute("data-prefetch")
}

describe("WatchHomeTvCarousel Watch Now prefetch posture", () => {
  it("ships the hero action with prefetch off on a touch device", () => {
    stubPointer("touch")
    const watchNow = renderCarousel()

    expect(watchNow, "Watch Now should render").not.toBeNull()
    // Still a working client-routed link: the click itself is unaffected.
    expect(watchNow?.getAttribute("href")).toBe(
      "/jesus.html/english.html?autoplay=1",
    )
    expect(watchNowPrefetch()).toBe("false")
  })

  it("keeps the eager desktop posture on a hover-capable device", () => {
    stubPointer("mouse")
    renderCarousel()

    expect(watchNowPrefetch()).toBe("undefined")
  })

  it("arms on focus, so keyboard and tap users still get a warm page", () => {
    stubPointer("touch")
    const watchNow = renderCarousel()

    act(() => {
      watchNow?.focus()
    })

    expect(document.activeElement).toBe(watchNow)
    expect(watchNowPrefetch()).toBe("undefined")
  })

  it("does not arm on touch movement, which is scrolling rather than intent", () => {
    stubPointer("touch")
    const watchNow = renderCarousel()

    act(() => {
      watchNow?.dispatchEvent(pointerEvent("pointermove", "touch"))
    })

    expect(watchNowPrefetch()).toBe("false")
  })

  it("arms on deliberate mouse movement, for a hybrid device", () => {
    stubPointer("touch")
    const watchNow = renderCarousel()

    act(() => {
      watchNow?.dispatchEvent(pointerEvent("pointermove", "mouse"))
    })

    expect(watchNowPrefetch()).toBe("undefined")
  })
})
