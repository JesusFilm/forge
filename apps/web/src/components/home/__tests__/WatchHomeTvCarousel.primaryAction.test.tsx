/**
 * @vitest-environment jsdom
 *
 * Pins the Watch home hero CTA's href against FGE-139 / W-003.
 *
 * `next/link` prefetches an in-viewport link whenever its `href` CHANGES, so a
 * destination that carries the live preview position re-prefetched once a
 * second for as long as an idle `/watch` tab stayed open (the audit measured 33
 * RSC fetches of one path in 35 s, 26,218 B each). The load-bearing assertion
 * here is therefore the STABILITY one: the rendered href must not move when the
 * playback position does. The click assertions exist so that stability cannot
 * be bought by dropping resume behaviour.
 *
 * `prefetch={false}` is the second half. These tests pin the explicit opt-out;
 * historical unequal-window counts do not identify a refresh mechanism or
 * replace matched production-build network measurements. `prefetch`
 * never reaches the DOM through a real `next/link` (it is destructured out
 * before the spread), so it is observable only through the mock's
 * `data-prefetch` below — see
 * `docs/solutions/best-practices/next-link-props-unobservable-three-vacuous-test-traps.md`.
 */
import { StrictMode, act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "../../../../messages/en.json"

const pushMock = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}))

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: {
    href: string
    prefetch?: boolean
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))

import { NextIntlClientProvider } from "next-intl"

import { HOVER_CAPABLE_POINTER_QUERY } from "../useTouchGatedPrefetch"
import { PrimaryAction } from "../WatchHomeTvCarousel"
import type { WatchHomeTvCarouselSlide } from "../useWatchHomeTvCarousel"

const slide: WatchHomeTvCarouselSlide = {
  kind: "video",
  id: "core-1",
  title: "Miraculous catch of fish",
  label: "Short film",
  // basePath-relative, exactly as `watchVideoPath` emits it — `/watch` is added
  // once by `next/link` and by `router.push`, never by the producer. Baking it in
  // here would pin a shape production never hands this component.
  href: "/miraculous-catch-of-fish.html",
  posterUrl: null,
  thumbnailUrl: null,
  imageAlt: null,
  src: null,
  playbackId: null,
  subtitleVttSrc: null,
  subtitleLanguageBcp47: null,
  durationSeconds: null,
} as unknown as WatchHomeTvCarouselSlide

// A second slide, so the click handler's slide-identity check has something to
// disagree with. Only `id` and `href` matter to `PrimaryAction`.
const otherSlide = {
  ...slide,
  id: "core-2",
  href: "/parable-of-the-sower.html",
} as unknown as WatchHomeTvCarouselSlide

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function renderAt(
  seconds: number,
  which: WatchHomeTvCarouselSlide = slide,
  strict = false,
) {
  const tree = (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PrimaryAction playbackTimeSeconds={seconds} slide={which} />
    </NextIntlClientProvider>
  )
  act(() => {
    root.render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  })
}

function clickAnchor(init: MouseEventInit = {}) {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  })
  act(() => {
    anchor().dispatchEvent(event)
  })
  return event
}

function anchor() {
  const el = container.querySelector("a")
  if (!el) throw new Error("hero CTA anchor did not render")
  return el
}

beforeEach(() => {
  pushMock.mockClear()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("Watch home hero CTA href", () => {
  it("does not move when the live playback position advances", () => {
    renderAt(21)
    const first = anchor().getAttribute("href")

    renderAt(22)
    const second = anchor().getAttribute("href")

    renderAt(23)
    const third = anchor().getAttribute("href")

    expect(first).toBe(second)
    expect(second).toBe(third)
  })

  it.each(["touch", "mouse"] as const)(
    "keeps hero prefetch disabled on %s through focus and pointer intent",
    (pointer) => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
          matches: pointer === "mouse" && query === HOVER_CAPABLE_POINTER_QUERY,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      )
      renderAt(21)
      const href = anchor().getAttribute("href")
      expect(anchor().getAttribute("data-prefetch")).toBe("false")

      for (const pointerType of ["touch", "mouse"]) {
        const event = new Event("pointermove", { bubbles: true })
        Object.defineProperty(event, "pointerType", { value: pointerType })
        act(() => anchor().dispatchEvent(event))
        expect(anchor().getAttribute("data-prefetch")).toBe("false")
      }
      act(() => anchor().focus())
      expect(document.activeElement).toBe(anchor())
      expect(anchor().getAttribute("data-prefetch")).toBe("false")

      renderAt(22)
      expect(anchor().getAttribute("href")).toBe(href)
      expect(anchor().getAttribute("data-prefetch")).toBe("false")
      expect(clickAnchor().defaultPrevented).toBe(true)
      expect(pushMock).toHaveBeenCalledTimes(1)
      expect(pushMock).toHaveBeenLastCalledWith(
        "/miraculous-catch-of-fish.html?t=22&autoplay=1",
      )
    },
  )

  it("renders the autoplay signal without a playback position", () => {
    renderAt(21)
    const href = anchor().getAttribute("href") ?? ""

    expect(href).toContain("/miraculous-catch-of-fish.html")
    expect(href).toContain("autoplay=1")
    expect(href).not.toContain("t=")
  })

  it("navigates to the resume position on a plain click", () => {
    renderAt(21)

    const event = clickAnchor()

    // `clickAnchor` returns the MouseEvent it dispatched. This pins only the
    // handler's cancellation; `next/link` is mocked here, so it does not show
    // what the real Link does with a cancelled event.
    expect(event.defaultPrevented).toBe(true)
    expect(pushMock).toHaveBeenCalledTimes(1)
    const pushed = String(pushMock.mock.calls[0]?.[0] ?? "")
    expect(pushed).toContain("t=21")
    expect(pushed).toContain("autoplay=1")
  })

  it("leaves a modified click to the browser so the new tab still opens", () => {
    renderAt(21)

    // Accepted tradeoff, not an oversight: the new tab opens at the stable href,
    // so it loses the resume position the old live href used to carry. That is
    // the direct cost of a href React can keep still.
    const event = clickAnchor({ metaKey: true })

    expect(pushMock).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it("leaves a middle click to the browser", () => {
    renderAt(21)

    const event = clickAnchor({ button: 1 })

    expect(pushMock).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it("leaves the click alone when there is no resume position yet", () => {
    renderAt(0)

    const event = clickAnchor()

    expect(pushMock).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it("stands down when something upstream already handled the click", () => {
    renderAt(21)

    // A listener ahead of this one in bubble order (analytics, RUM) can call
    // preventDefault first. Pushing anyway would navigate out from under it.
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    event.preventDefault()
    act(() => {
      anchor().dispatchEvent(event)
    })

    expect(pushMock).not.toHaveBeenCalled()
  })

  it("never carries the previous slide's position onto the next slide", () => {
    renderAt(45)

    // The production shape of a carousel advance: `useWatchHomeTvCarousel`
    // derives `playbackTimeSeconds` as 0 whenever `playbackTime.slideId` is not
    // the active slide, so the new slide arrives at 0 in the same commit that
    // swaps the href. `PrimaryAction` is not re-keyed, so this is the SAME hook
    // instance carrying a ref that was holding 45 a moment ago.
    renderAt(0, otherSlide)

    expect(anchor().getAttribute("href")).toBe(
      "/parable-of-the-sower.html?autoplay=1",
    )

    const event = clickAnchor()

    expect(pushMock).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it("survives a StrictMode remount with its click behaviour intact", () => {
    // The repo's standing law: a hook-lifetime ref is only proven safe under
    // StrictMode's setup -> cleanup -> setup cycle, which reuses the same hook
    // instance. See
    // docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md
    renderAt(21, slide, true)

    clickAnchor()

    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(String(pushMock.mock.calls[0]?.[0] ?? "")).toContain("t=21")
  })
})
