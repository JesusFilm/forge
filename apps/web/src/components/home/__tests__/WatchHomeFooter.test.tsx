/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WatchHomeFooter } from "@/components/home/WatchHomeFooter"

vi.mock("next/image", () => ({
  default: ({
    alt,
    className,
    src,
  }: {
    alt: string
    className?: string
    src: string
  }) => (
    <span role="img" aria-label={alt} className={className} data-src={src} />
  ),
}))

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

describe("WatchHomeFooter", () => {
  it("paints its complete white surface above preceding sticky media", () => {
    act(() => {
      root.render(<WatchHomeFooter />)
    })

    const footer = container.querySelector('[data-testid="watch-home-footer"]')

    expect(footer?.tagName).toBe("FOOTER")
    expect(footer?.className).toContain("relative")
    expect(footer?.className).toContain("z-20")
    expect(footer?.className).toContain("bg-white")
  })
})
