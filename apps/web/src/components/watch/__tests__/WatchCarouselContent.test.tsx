/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { useEmblaCarouselMock } = vi.hoisted(() => {
  const emblaApi = {
    canScrollPrev: vi.fn(() => false),
    canScrollNext: vi.fn(() => false),
    scrollPrev: vi.fn(),
    scrollNext: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }
  return {
    useEmblaCarouselMock: vi.fn(
      (_options?: {
        align?: (viewSize: number, snapSize: number, index: number) => number
      }) => [vi.fn(), emblaApi],
    ),
  }
})

vi.mock("embla-carousel-react", () => ({
  default: useEmblaCarouselMock,
}))

import { CarouselItem } from "@/components/ui/carousel"
import {
  WatchCarousel,
  WatchCarouselContent,
} from "@/components/watch/WatchCarouselContent"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  useEmblaCarouselMock.mockClear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderContent(
  props: ComponentProps<typeof WatchCarouselContent> = {},
) {
  const { layout, ...contentProps } = props
  act(() => {
    root.render(
      <WatchCarousel layout={layout}>
        <WatchCarouselContent layout={layout} {...contentProps}>
          <CarouselItem data-testid="real-slide">One</CarouselItem>
        </WatchCarouselContent>
      </WatchCarousel>,
    )
  })
}

describe("WatchCarouselContent", () => {
  it("bleeds the clipped viewport while keeping card zero content-aligned", () => {
    renderContent({
      className: "custom-track-gap",
      endSpacerTestId: "watch-end-spacer",
    })

    const viewport = container.querySelector('[data-slot="carousel-content"]')
    const track = viewport?.firstElementChild
    const spacer = container.querySelector('[data-testid="watch-end-spacer"]')

    expect(viewport?.className).toContain("overflow-x-clip")
    expect(viewport?.className).toContain("overflow-y-visible")
    expect(viewport?.className).toContain("-mx-5")
    expect(viewport?.className).toContain("md:-mx-16")
    expect(viewport?.className).toContain("xl:-mx-24")
    expect(viewport?.className).not.toContain("overflow-x-visible")
    expect(track?.className).toContain("pl-5")
    expect(track?.className).toContain("md:pl-16")
    expect(track?.className).toContain("xl:pl-24")
    expect(track?.className).toContain("custom-track-gap")
    expect(spacer?.getAttribute("aria-hidden")).toBe("true")
    expect(spacer?.getAttribute("tabindex")).toBe("-1")
    expect(spacer?.className).toContain("xl:w-24")
  })

  it("uses centered inventory alignment without applying rail bleed", () => {
    renderContent({ layout: "inventory", endSpacerTestId: "inventory-end" })

    const viewport = container.querySelector('[data-slot="carousel-content"]')
    const track = viewport?.firstElementChild
    const spacer = container.querySelector('[data-testid="inventory-end"]')

    expect(viewport?.className).not.toContain("-mx-5")
    expect(track?.className).toContain("sm:pl-[max(2rem,calc(50%_-_38rem))]")
    expect(spacer?.className).toContain("sm:w-[max(2rem,calc(50%_-_38rem))]")

    const align = useEmblaCarouselMock.mock.calls.at(-1)?.[0]?.align
    expect(align?.(1920, 0, 0)).toBe(352)
  })

  it("lets looping rails omit only the terminal spacer", () => {
    renderContent({ endSpacer: false })

    expect(
      container.querySelectorAll('[data-slot="carousel-item"]'),
    ).toHaveLength(1)
    expect(
      container.querySelector('[data-slot="carousel-content"]')?.className,
    ).toContain("-mx-5")

    const align = useEmblaCarouselMock.mock.calls.at(-1)?.[0]?.align
    expect(align?.(1920, 0, 0)).toBe(96)
  })
})
