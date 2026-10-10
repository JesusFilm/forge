/**
 * @vitest-environment jsdom
 *
 * Pins the category rail's touch-gated prefetch posture (W-025).
 *
 * On a touch device every visible rail link used to fire a speculative
 * `?_rsc=` document prefetch on load. The links now ship with prefetch off and
 * arm per link on intent (focus, or deliberate mouse movement); a
 * hover-capable desktop arms them right after mount, keeping the eager
 * posture the bounded rail had before. `next/link` strips `prefetch` before
 * spreading onto the anchor, so the sibling suite (which renders through
 * `renderToStaticMarkup` with a real Link) cannot see it. This file mocks
 * `next/link` to reflect the prop onto `data-prefetch`.
 */
import { act } from "react"
import { createRoot, hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
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
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock("@/components/ui/carousel", () => {
  const Passthrough = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    Carousel: Passthrough,
    CarouselContent: Passthrough,
    CarouselItem: Passthrough,
    CarouselNext: () => null,
    CarouselPrevious: () => null,
  }
})

import { NextIntlClientProvider } from "next-intl"

import { HOVER_CAPABLE_POINTER_QUERY } from "../useTouchGatedPrefetch"
import { WatchHomeCategoryRail } from "../WatchHomeCategoryRail"

let container: HTMLDivElement
let root: ReturnType<typeof createRoot> | undefined

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = undefined
})

afterEach(() => {
  act(() => root?.unmount())
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
    })),
  )
}

/** jsdom has no PointerEvent constructor; React only reads `pointerType`. */
function pointerEvent(type: string, pointerType: string) {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, "pointerType", { value: pointerType })
  return event
}

function renderRail() {
  root = createRoot(container)
  act(() => {
    root?.render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <WatchHomeCategoryRail languageSlug="english" />
      </NextIntlClientProvider>,
    )
  })
}

function prefetchOf(selector: string) {
  return container.querySelector(selector)?.getAttribute("data-prefetch")
}

function tilePrefetchValues() {
  return Array.from(
    container.querySelectorAll('[data-testid^="watch-home-category-card-"]'),
    (tile) => tile.getAttribute("data-prefetch"),
  )
}

const SEE_ALL = '[data-testid="watch-home-category-see-all"]'

describe("WatchHomeCategoryRail prefetch posture", () => {
  it("ships every rail link with prefetch off on a touch device", () => {
    stubPointer("touch")
    renderRail()

    const tiles = tilePrefetchValues()
    expect(tiles.length, "the default rail should render tiles").toBe(13)
    // "false" is an explicit disable; "undefined" would be the default
    // viewport strategy that fanned out on phones.
    expect(new Set(tiles)).toEqual(new Set(["false"]))
    expect(prefetchOf(SEE_ALL)).toBe("false")
  })

  it("keeps the eager desktop posture on a hover-capable device", () => {
    stubPointer("mouse")
    renderRail()

    expect(new Set(tilePrefetchValues())).toEqual(new Set(["undefined"]))
    expect(prefetchOf(SEE_ALL)).toBe("undefined")
  })

  /**
   * The real desktop path: server HTML is gated (the server cannot know the
   * pointer), and hydration flips it to the default strategy. `createRoot`
   * alone never exercises the server snapshot, so this uses `hydrateRoot`.
   */
  it("hydrates gated server markup into eager prefetch on a desktop", () => {
    stubPointer("mouse")
    const rail = (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <WatchHomeCategoryRail languageSlug="english" />
      </NextIntlClientProvider>
    )
    container.innerHTML = renderToString(rail)
    expect(prefetchOf(SEE_ALL)).toBe("false")

    const recoverableErrors: unknown[] = []
    act(() => {
      root = hydrateRoot(container, rail, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      })
    })

    expect(recoverableErrors).toEqual([])
    expect(prefetchOf(SEE_ALL)).toBe("undefined")
    expect(new Set(tilePrefetchValues())).toEqual(new Set(["undefined"]))
  })

  it("treats a browser without matchMedia as touch, failing closed", () => {
    vi.stubGlobal("matchMedia", undefined)
    renderRail()

    expect(new Set(tilePrefetchValues())).toEqual(new Set(["false"]))
  })

  /**
   * Focus is the keyboard intent path, and on touch browsers that focus a
   * tapped link (Android Chrome) it lands just before the click. Only the focused link may
   * arm — a rail-wide latch would refetch all thirteen pages on one tap.
   */
  it("arms only the focused link, so one tap does not fan out", () => {
    stubPointer("touch")
    renderRail()

    const first = container.querySelector<HTMLAnchorElement>(
      '[data-testid^="watch-home-category-card-"]',
    )
    act(() => {
      first?.focus()
    })

    expect(document.activeElement).toBe(first)
    const values = tilePrefetchValues()
    expect(values[0]).toBe("undefined")
    expect(values.slice(1)).toEqual(Array(values.length - 1).fill("false"))
    expect(prefetchOf(SEE_ALL)).toBe("false")
  })

  it("arms the see-all link on focus", () => {
    stubPointer("touch")
    renderRail()

    act(() => {
      container.querySelector<HTMLAnchorElement>(SEE_ALL)?.focus()
    })

    expect(prefetchOf(SEE_ALL)).toBe("undefined")
  })

  /**
   * A touch scroll drags `pointermove` across every tile it passes. Without
   * the pointer-type check one swipe through the rail would arm all of it.
   */
  it("does not arm on touch movement, which is scrolling rather than intent", () => {
    stubPointer("touch")
    renderRail()

    const tile = container.querySelector(
      '[data-testid^="watch-home-category-card-"]',
    )
    act(() => {
      tile?.dispatchEvent(pointerEvent("pointermove", "touch"))
    })

    expect(tilePrefetchValues()[0]).toBe("false")
  })

  it("arms on deliberate mouse movement, for a hybrid device", () => {
    stubPointer("touch")
    renderRail()

    const tile = container.querySelector(
      '[data-testid^="watch-home-category-card-"]',
    )
    act(() => {
      tile?.dispatchEvent(pointerEvent("pointermove", "mouse"))
    })

    expect(tilePrefetchValues()[0]).toBe("undefined")
  })

  /**
   * The negative half of the marker assertion, and the only test in the suite
   * that can tell a Link from a raw anchor.
   *
   * The mock stamps `data-prefetch` on everything it renders, so its presence
   * means "this went through next/link" and its absence means "this is a real
   * `<a>`". Without this case, reverting the internal branch at
   * `WatchHomeCategoryRail.tsx` from `<Link>` to `<a>` keeps every href, target
   * and rel assertion in the sibling suite green — the exact one-line revert
   * that reintroduces a full document reload.
   */
  it("routes an external destination to a real anchor and an internal one to Link", () => {
    root = createRoot(container)
    act(() => {
      root?.render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <WatchHomeCategoryRail
            languageSlug="english"
            tiles={[
              { id: "ext", title: "Give", href: "https://example.org/give" },
              { id: "int", title: "Partners", href: "/partners" },
            ]}
          />
        </NextIntlClientProvider>,
      )
    })

    const external = container.querySelector(
      '[data-testid="watch-home-category-card-ext"]',
    )
    const internal = container.querySelector(
      '[data-testid="watch-home-category-card-int"]',
    )

    expect(external?.getAttribute("target")).toBe("_blank")
    // A real anchor: the Link mock never touched it.
    expect(external?.hasAttribute("data-prefetch")).toBe(false)

    // Went through next/link, so it is a client-side navigation.
    expect(internal?.hasAttribute("data-prefetch")).toBe(true)
    expect(internal?.getAttribute("target")).toBeNull()
  })
})
