/**
 * @vitest-environment jsdom
 *
 * Pins the card's intent-gated prefetch latch.
 *
 * `next/link` strips `prefetch` before spreading onto the anchor, so the prop
 * is invisible in the DOM and no unmocked suite can observe it. This file
 * mocks `next/link` the way `SiblingCarousel.test.tsx` does — reflecting
 * `prefetch` onto a data attribute — so the latch is assertable at all.
 *
 * Without this file, reverting the card to a permanent `prefetch={false}`, or
 * swapping `onPointerMove` back to `onPointerEnter`, leaves every other suite
 * green.
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("embla-carousel-react", () => ({
  default: vi.fn(() => [vi.fn(), null]),
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

import { MediaCollection } from "./MediaCollection"

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

/** jsdom has no PointerEvent constructor; React only reads `pointerType`. */
function pointerEvent(type: string, pointerType: string) {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, "pointerType", { value: pointerType })
  return event
}

function renderCard() {
  act(() => {
    root.render(
      <MediaCollection
        languageSlug="english"
        data={
          {
            id: "block-1",
            itemsSource: "manual",
            items: [
              { id: "i-1", videoId: "v-1", videoSlug: "jesus", title: "JESUS" },
            ],
          } as never
        }
      />,
    )
  })
  return container.querySelector<HTMLAnchorElement>(
    'a[data-testid="VideoCard"]',
  )
}

describe("MediaCollection card prefetch latch", () => {
  it("ships prefetch disabled so a windowed feed does not fan out", () => {
    expect(renderCard()?.getAttribute("data-prefetch")).toBe("false")
  })

  it("arms on deliberate mouse movement over the card", () => {
    const card = renderCard()
    act(() => {
      card?.dispatchEvent(pointerEvent("pointermove", "mouse"))
    })
    expect(
      container
        .querySelector('a[data-testid="VideoCard"]')
        ?.getAttribute("data-prefetch"),
    ).toBe("undefined")
  })

  it("arms on focus, so keyboard users get the same warm destination", () => {
    const card = renderCard()
    act(() => {
      card?.dispatchEvent(new Event("focusin", { bubbles: true }))
    })
    expect(
      container
        .querySelector('a[data-testid="VideoCard"]')
        ?.getAttribute("data-prefetch"),
    ).toBe("undefined")
  })

  /**
   * The discriminating case for the movement requirement. `pointerenter` also
   * fires when the windowed feed scrolls a card under a stationary pointer,
   * which is not intent — so reverting the handler to `onPointerEnter` turns
   * only this test red.
   */
  it("does not arm on pointer entry alone", () => {
    const card = renderCard()
    act(() => {
      card?.dispatchEvent(pointerEvent("pointerenter", "mouse"))
    })
    expect(
      container
        .querySelector('a[data-testid="VideoCard"]')
        ?.getAttribute("data-prefetch"),
    ).toBe("false")
  })

  /**
   * The discriminating case for the pointer-type requirement. A touch scroll
   * drags `pointermove` across every card it passes, so without the
   * hover-capable check a single flick would arm the whole rail — exactly the
   * fan-out the latch exists to prevent.
   */
  it("does not arm on touch movement, which is scrolling rather than intent", () => {
    const card = renderCard()
    act(() => {
      card?.dispatchEvent(pointerEvent("pointermove", "touch"))
    })
    expect(
      container
        .querySelector('a[data-testid="VideoCard"]')
        ?.getAttribute("data-prefetch"),
    ).toBe("false")
  })
})
