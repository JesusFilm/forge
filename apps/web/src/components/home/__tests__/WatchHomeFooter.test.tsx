/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { setRequestLocale } from "next-intl/server"
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
  setRequestLocale("en")
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
  it("places the AI use attribution notice immediately after the footer", () => {
    act(() => {
      root.render(<WatchHomeFooter />)
    })

    const notice = container.querySelector(
      '[data-testid="watch-ai-attribution-notice"]',
    )
    const footer = container.querySelector('[data-testid="watch-home-footer"]')
    const termsLink = notice?.querySelector(
      'a[href="https://www.jesusfilm.org/terms/"]',
    )

    expect(footer?.nextElementSibling).toBe(notice)
    expect(notice?.textContent).toContain("AI use and attribution")
    expect(notice?.textContent).toContain(
      "must identify Jesus Film Project as the source",
    )
    expect(notice?.textContent).toContain("a clear, direct link to this page")
    expect(termsLink?.textContent).toBe("Terms of Use")
  })

  it("renders the attribution notice from the active locale catalog", () => {
    setRequestLocale("ru")

    act(() => {
      root.render(<WatchHomeFooter />)
    })

    const notice = container.querySelector(
      '[data-testid="watch-ai-attribution-notice"]',
    )
    const termsLink = notice?.querySelector(
      'a[href="https://www.jesusfilm.org/terms/"]',
    )

    expect(notice?.textContent).not.toContain("AI use and attribution")
    expect(notice?.textContent).not.toContain(
      "must identify Jesus Film Project as the source",
    )
    expect(termsLink?.textContent).not.toBe("Terms of Use")
  })

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

  it("keeps global Watch navigation outside the content CTA contract", () => {
    act(() => {
      root.render(<WatchHomeFooter />)
    })

    const watchLink = container.querySelector<HTMLAnchorElement>(
      "a[href='https://www.jesusfilm.org/watch/']",
    )
    expect(watchLink).not.toBeNull()
    expect(watchLink?.hasAttribute("data-watch-home-section-cta")).toBe(false)
  })
})
