/**
 * @vitest-environment jsdom
 */

import React, { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/image", () => ({
  default: ({
    alt,
    className,
    src,
  }: {
    alt: string
    className?: string
    src: string
  }) => React.createElement("img", { src, alt, className }),
}))

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode
    href: string
  } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import { WatchNotFound } from "@/components/WatchNotFound"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function renderPage() {
  act(() => {
    root.render(<WatchNotFound />)
  })
}

describe("WatchNotFound", () => {
  it("renders one accessible heading and a decorative 404 marker", () => {
    renderPage()

    const headings = container.querySelectorAll("h1")
    expect(headings).toHaveLength(1)
    expect(headings[0]?.textContent).toContain(
      "Page not found: This scene isn't here.",
    )

    const marker = container.querySelector(
      '[data-testid="watch-not-found-code"]',
    )
    expect(marker?.textContent?.trim()).toBe("404")
    expect(marker?.getAttribute("aria-hidden")).toBe("true")
  })

  it("links to Watch home and the language inventory with accessible names", () => {
    renderPage()

    const links = container.querySelectorAll("a")
    expect(links).toHaveLength(2)
    expect(links[0]?.getAttribute("href")).toBe("/")
    expect(links[0]?.textContent?.trim()).toBe("Back to Watch")
    expect(links[1]?.getAttribute("href")).toBe("/languages")
    expect(links[1]?.textContent?.trim()).toBe("Browse videos")
  })

  it("uses one local decorative artwork image", () => {
    renderPage()

    const images = container.querySelectorAll("img")
    expect(images).toHaveLength(1)
    expect(images[0]?.getAttribute("src")).toBe(
      "/watch/images/thumbnails/11_Advent0304-vertical.jpg",
    )
    expect(images[0]?.getAttribute("alt")).toBe("")
    expect(images[0]?.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it("keeps the composition scrollable and safe-area aware", () => {
    renderPage()

    const main = container.querySelector("main")
    expect(main?.className).toContain("min-h-svh")
    expect(main?.className).toContain("overflow-y-auto")

    const content = container.querySelector(
      '[aria-labelledby="watch-not-found-heading"]',
    )?.parentElement
    expect(content?.className).toContain("env(safe-area-inset-top,0px)")
    expect(content?.className).toContain("env(safe-area-inset-bottom,0px)")
  })
})
