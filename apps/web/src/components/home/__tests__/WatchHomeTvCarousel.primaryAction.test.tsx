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
 * `prefetch` posture is deliberately NOT asserted — this fix makes the href
 * stable rather than unprefetched, leaving FGE-215 (W-025) free to decide it.
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

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

import { PrimaryAction } from "../WatchHomeTvCarousel"
import type { WatchHomeTvCarouselSlide } from "../useWatchHomeTvCarousel"

const slide: WatchHomeTvCarouselSlide = {
  kind: "video",
  id: "core-1",
  title: "Miraculous catch of fish",
  label: "Short film",
  href: "/watch/miraculous-catch-of-fish.html",
  posterUrl: null,
  thumbnailUrl: null,
  imageAlt: null,
  src: null,
  playbackId: null,
  subtitleVttSrc: null,
  subtitleLanguageBcp47: null,
  durationSeconds: null,
} as unknown as WatchHomeTvCarouselSlide

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function renderAt(seconds: number) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PrimaryAction playbackTimeSeconds={seconds} slide={slide} />
      </NextIntlClientProvider>,
    )
  })
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

  it("renders the autoplay signal without a playback position", () => {
    renderAt(21)
    const href = anchor().getAttribute("href") ?? ""

    expect(href).toContain("/watch/miraculous-catch-of-fish.html")
    expect(href).toContain("autoplay=1")
    expect(href).not.toContain("t=")
  })

  it("navigates to the resume position on a plain click", () => {
    renderAt(21)

    act(() => {
      anchor().dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      )
    })

    expect(pushMock).toHaveBeenCalledTimes(1)
    const pushed = String(pushMock.mock.calls[0]?.[0] ?? "")
    expect(pushed).toContain("t=21")
    expect(pushed).toContain("autoplay=1")
  })

  it("leaves a modified click to the browser so the new tab still opens", () => {
    renderAt(21)

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    Object.defineProperty(event, "metaKey", { value: true })

    act(() => {
      anchor().dispatchEvent(event)
    })

    expect(pushMock).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it("leaves the click alone when there is no resume position yet", () => {
    renderAt(0)

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    })

    act(() => {
      anchor().dispatchEvent(event)
    })

    expect(pushMock).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})
