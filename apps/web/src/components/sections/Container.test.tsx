/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { Container } from "@/components/sections/Container"

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

describe("Container", () => {
  it("removes twelve-column horizontal gaps below the desktop breakpoint", () => {
    const data = {
      __typename: "ContainerBlock",
      id: "two-column-cta",
      content: [
        {
          __typename: "ContainerSlotBlock",
          gridSpan: 6,
        },
        {
          __typename: "CtaBlock",
          id: "chat-cta",
          heading: "Talk it through",
          body: "Discuss your questions.",
          buttonLabel: "Chat with a person",
          buttonLink: "https://example.com/chat",
          backgroundColor: "transparent",
          ctaVariant: "secondary",
        },
        {
          __typename: "ContainerSlotBlock",
          gridSpan: 6,
        },
        {
          __typename: "CtaBlock",
          id: "ask-cta",
          heading: "Ask a Bible question",
          body: "Keep exploring.",
          buttonLabel: "Ask a Bible question",
          buttonLink: "https://example.com/ask",
          backgroundColor: "transparent",
          ctaVariant: "secondary",
        },
      ],
    } as unknown as Parameters<typeof Container>[0]["data"]

    act(() => {
      root.render(<Container data={data} />)
    })

    const grid = container.querySelector('[data-testid="Container"]')
    expect(grid?.className).toContain("gap-x-0")
    expect(grid?.className).toContain("gap-y-10")
    expect(grid?.className).toContain("md:gap-6")
    expect(container.querySelectorAll("h2")).toHaveLength(2)
  })
})
