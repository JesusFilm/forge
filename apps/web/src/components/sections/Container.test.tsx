/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./BibleQuotesCarousel", () => ({
  BibleQuotesCarousel: () => <div data-testid="bible-carousel-mock" />,
}))

vi.mock("./MediaCollection", () => ({
  MediaCollection: () => <div data-testid="media-collection-mock" />,
}))

import { Container } from "./Container"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderSlot(item: Record<string, unknown>) {
  act(() => {
    root.render(
      <Container
        data={
          {
            id: "container",
            content: [
              {
                __typename: "ContainerSlotBlock",
                gridSpan: 6,
                spans: { xs: 12, sm: 12, md: 6, lg: 5, xl: 4 },
              },
              item,
            ],
          } as unknown as Parameters<typeof Container>[0]["data"]
        }
      />,
    )
  })

  return container.querySelector(
    '[data-testid="Container"] > div',
  ) as HTMLDivElement
}

describe("Container full-bleed Watch carousel slots", () => {
  it.each([
    { __typename: "BibleQuotesCarouselBlock" },
    {
      __typename: "MediaCollectionBlock",
      mediaCollectionVariant: "carousel",
    },
  ])("promotes $.__typename carousel content to every grid column", (item) => {
    const slot = renderSlot(item)

    for (const breakpoint of ["xs", "sm", "md", "lg", "xl"]) {
      expect(slot.style.getPropertyValue(`--slot-${breakpoint}`)).toBe("12")
    }
  })

  it("preserves authored spans for non-carousel media collections", () => {
    const slot = renderSlot({
      __typename: "MediaCollectionBlock",
      mediaCollectionVariant: "grid",
    })

    expect(slot.style.getPropertyValue("--slot-md")).toBe("6")
    expect(slot.style.getPropertyValue("--slot-lg")).toBe("5")
    expect(slot.style.getPropertyValue("--slot-xl")).toBe("4")
  })
})
