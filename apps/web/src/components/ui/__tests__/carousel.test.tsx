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
} from "@/components/ui/carousel"

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

function renderCarousel(orientation: "horizontal" | "vertical" = "horizontal") {
  act(() => {
    root.render(
      <Carousel orientation={orientation}>
        <CarouselContent>
          <CarouselItem>One</CarouselItem>
          <CarouselItem>Two</CarouselItem>
        </CarouselContent>
      </Carousel>,
    )
  })
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
    renderCarousel("vertical")

    const event = wheelContent(40)

    expect(emblaApi.scrollNext).not.toHaveBeenCalled()
    expect(emblaApi.scrollPrev).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})
