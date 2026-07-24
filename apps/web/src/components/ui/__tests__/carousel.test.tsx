/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { emblaApi, useEmblaCarouselMock } = vi.hoisted(() => {
  const emblaApi = {
    canScrollPrev: vi.fn(() => true),
    canScrollNext: vi.fn(() => true),
    scrollPrev: vi.fn(),
    scrollNext: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }
  return {
    emblaApi,
    useEmblaCarouselMock: vi.fn(() => [vi.fn(), emblaApi]),
  }
})

vi.mock("embla-carousel-react", () => ({
  default: useEmblaCarouselMock,
}))

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import {
  DirectionProvider,
  type TextDirection,
} from "@/components/DirectionProvider"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  emblaApi.canScrollPrev.mockReturnValue(true)
  emblaApi.canScrollNext.mockReturnValue(true)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function renderCarousel({
  direction = "ltr",
  orientation = "horizontal",
  opts,
}: {
  direction?: TextDirection
  orientation?: "horizontal" | "vertical"
  opts?: { direction?: TextDirection }
} = {}) {
  act(() => {
    root.render(
      <DirectionProvider direction={direction}>
        <Carousel orientation={orientation} opts={opts}>
          <CarouselContent>
            <CarouselItem>One</CarouselItem>
            <CarouselItem>Two</CarouselItem>
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </DirectionProvider>,
    )
  })
}

function keyDownCarousel(key: string): KeyboardEvent {
  const carousel = container.querySelector(
    '[data-slot="carousel"]',
  ) as HTMLDivElement
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
  })
  carousel.dispatchEvent(event)
  return event
}

function wheelContent(deltaX: number, deltaY = 0): WheelEvent {
  const content = container.querySelector(
    '[data-slot="carousel-content"]',
  ) as HTMLDivElement
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaX,
    deltaY,
  })
  content.dispatchEvent(event)
  return event
}

describe("CarouselContent — horizontal wheel support", () => {
  it("clips horizontal overflow by default", () => {
    renderCarousel()

    const content = container.querySelector('[data-slot="carousel-content"]')
    expect(content?.className).toContain("overflow-x-clip")
    expect(content?.className).toContain("overflow-y-visible")
  })

  it("moves to the next slide on horizontal wheel right", () => {
    renderCarousel()

    wheelContent(40)

    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1)
    expect(emblaApi.scrollPrev).not.toHaveBeenCalled()
  })

  it("moves to the previous slide on horizontal wheel left", () => {
    renderCarousel()

    wheelContent(-40)

    expect(emblaApi.scrollPrev).toHaveBeenCalledTimes(1)
    expect(emblaApi.scrollNext).not.toHaveBeenCalled()
  })

  it("ignores mostly vertical wheel gestures", () => {
    renderCarousel()

    const event = wheelContent(6, 80)

    expect(emblaApi.scrollNext).not.toHaveBeenCalled()
    expect(emblaApi.scrollPrev).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it("does not consume horizontal wheel when the carousel cannot scroll that way", () => {
    emblaApi.canScrollNext.mockReturnValue(false)
    renderCarousel()

    const event = wheelContent(40)

    expect(emblaApi.scrollNext).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it("leaves vertical carousels alone", () => {
    renderCarousel({ orientation: "vertical" })

    const event = wheelContent(40)

    expect(emblaApi.scrollNext).not.toHaveBeenCalled()
    expect(emblaApi.scrollPrev).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it("moves to the next slide on horizontal wheel left in RTL", () => {
    renderCarousel({ direction: "rtl" })

    wheelContent(-40)

    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1)
    expect(emblaApi.scrollPrev).not.toHaveBeenCalled()
  })

  it("moves to the previous slide on horizontal wheel right in RTL", () => {
    renderCarousel({ direction: "rtl" })

    wheelContent(40)

    expect(emblaApi.scrollPrev).toHaveBeenCalledTimes(1)
    expect(emblaApi.scrollNext).not.toHaveBeenCalled()
  })

  it("does not consume RTL wheel left at the semantic next boundary", () => {
    emblaApi.canScrollNext.mockReturnValue(false)
    renderCarousel({ direction: "rtl" })

    const event = wheelContent(-40)

    expect(emblaApi.scrollNext).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})

describe("Carousel — direction contract", () => {
  it.each(["ltr", "rtl"] as const)(
    "passes %s direction to Embla",
    (direction) => {
      renderCarousel({ direction })

      expect(useEmblaCarouselMock).toHaveBeenCalledWith(
        expect.objectContaining({ axis: "x", direction }),
        undefined,
      )
    },
  )

  it("keeps the inherited direction authoritative over caller options", () => {
    renderCarousel({ direction: "rtl", opts: { direction: "ltr" } })

    expect(useEmblaCarouselMock).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "rtl" }),
      undefined,
    )
  })

  it("maps horizontal keys to semantic previous and next in LTR", () => {
    renderCarousel()

    keyDownCarousel("ArrowLeft")

    expect(emblaApi.scrollPrev).toHaveBeenCalledTimes(1)
    expect(emblaApi.scrollNext).not.toHaveBeenCalled()

    vi.clearAllMocks()
    keyDownCarousel("ArrowRight")

    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1)
    expect(emblaApi.scrollPrev).not.toHaveBeenCalled()
  })

  it("maps horizontal keys to semantic next and previous in RTL", () => {
    renderCarousel({ direction: "rtl" })

    keyDownCarousel("ArrowLeft")

    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1)
    expect(emblaApi.scrollPrev).not.toHaveBeenCalled()

    vi.clearAllMocks()
    keyDownCarousel("ArrowRight")

    expect(emblaApi.scrollPrev).toHaveBeenCalledTimes(1)
    expect(emblaApi.scrollNext).not.toHaveBeenCalled()
  })

  it("keeps vertical key semantics unchanged in RTL", () => {
    renderCarousel({ direction: "rtl" })

    keyDownCarousel("ArrowUp")

    expect(emblaApi.scrollPrev).toHaveBeenCalledTimes(1)
    expect(emblaApi.scrollNext).not.toHaveBeenCalled()

    vi.clearAllMocks()
    keyDownCarousel("ArrowDown")

    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1)
    expect(emblaApi.scrollPrev).not.toHaveBeenCalled()
  })

  it("uses logical horizontal gutters", () => {
    renderCarousel()

    const track = container.querySelector(
      '[data-slot="carousel-content"] > div',
    )
    const item = container.querySelector('[data-slot="carousel-item"]')

    expect(track?.className).toContain("-ms-4")
    expect(track?.className).not.toContain("-ml-4")
    expect(item?.className).toContain("ps-4")
    expect(item?.className).not.toContain("pl-4")
  })

  it.each([
    {
      direction: "ltr" as const,
      previousIcon: "lucide-chevron-left",
      nextIcon: "lucide-chevron-right",
    },
    {
      direction: "rtl" as const,
      previousIcon: "lucide-chevron-right",
      nextIcon: "lucide-chevron-left",
    },
  ])(
    "places controls on logical edges and mirrors icons in $direction",
    ({ direction, previousIcon, nextIcon }) => {
      renderCarousel({ direction })

      const previous = container.querySelector(
        '[data-slot="carousel-previous"]',
      ) as HTMLButtonElement
      const next = container.querySelector(
        '[data-slot="carousel-next"]',
      ) as HTMLButtonElement

      expect(previous.className).toContain("-start-12")
      expect(previous.className).not.toContain("-left-12")
      expect(previous.querySelector("svg")?.classList).toContain(previousIcon)
      expect(next.className).toContain("-end-12")
      expect(next.className).not.toContain("-right-12")
      expect(next.querySelector("svg")?.classList).toContain(nextIcon)
    },
  )

  it("keeps vertical control glyphs mapped to previous and next in RTL", () => {
    renderCarousel({ direction: "rtl", orientation: "vertical" })

    const previous = container.querySelector(
      '[data-slot="carousel-previous"] svg',
    )
    const next = container.querySelector('[data-slot="carousel-next"] svg')

    expect(previous?.classList).toContain("lucide-chevron-left")
    expect(next?.classList).toContain("lucide-chevron-right")
  })
})
