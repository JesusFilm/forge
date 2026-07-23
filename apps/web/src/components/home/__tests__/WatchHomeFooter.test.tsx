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

function renderFooter() {
  act(() => {
    root.render(<WatchHomeFooter />)
  })
}

describe("WatchHomeFooter", () => {
  it("places the AI use attribution notice immediately after the footer", () => {
    renderFooter()

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

    renderFooter()

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

  it("omits social and newsletter actions", () => {
    renderFooter()

    const removedHrefs = [
      "https://twitter.com/jesusfilm",
      "https://www.facebook.com/jesusfilm",
      "https://www.instagram.com/jesusfilm",
      "https://www.youtube.com/user/jesusfilm",
      "https://www.jesusfilm.org/email/",
    ]

    removedHrefs.forEach((href) => {
      expect(container.querySelector(`a[href="${href}"]`)).toBeNull()
    })

    const removedLabels = ["X", "Facebook", "Instagram", "YouTube"]
    removedLabels.forEach((label) => {
      expect(container.querySelector(`a[aria-label="${label}"]`)).toBeNull()
    })
    expect(container.textContent).not.toContain("Sign Up For Our Newsletter")
  })

  it("keeps contact details in three adjacent columns", () => {
    renderFooter()

    const contactGrid = container.querySelector(
      '[data-testid="watch-footer-contact-grid"]',
    )

    expect(contactGrid?.classList.contains("grid")).toBe(true)
    expect(contactGrid?.classList.contains("grid-cols-3")).toBe(true)
    expect(contactGrid?.classList.contains("break-words")).toBe(true)
    expect(contactGrid?.children).toHaveLength(3)

    const [address, phoneNumbers, legalLinks] = Array.from(
      contactGrid?.children ?? [],
    )
    expect(address?.classList.contains("border-e")).toBe(true)
    expect(address?.classList.contains("pe-3")).toBe(true)
    expect(phoneNumbers?.classList.contains("border-e")).toBe(true)
    expect(legalLinks?.classList.contains("ps-3")).toBe(true)
  })

  it("paints its complete white surface above preceding sticky media", () => {
    renderFooter()

    const footer = container.querySelector('[data-testid="watch-home-footer"]')

    expect(footer?.tagName).toBe("FOOTER")
    expect(footer?.className).toContain("relative")
    expect(footer?.className).toContain("z-20")
    expect(footer?.className).toContain("bg-white")
  })
})
