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

  it("keeps Give Now in the single-row navigation layout from medium widths", () => {
    renderFooter()

    const navigation = container.querySelector(
      '[data-testid="watch-footer-navigation"]',
    )

    expect(navigation?.classList.contains("min-w-0")).toBe(true)
    expect(navigation?.classList.contains("md:flex-nowrap")).toBe(true)
    expect(navigation?.classList.contains("md:justify-between")).toBe(true)
    expect(navigation?.lastElementChild?.textContent).toBe("Give Now")

    Array.from(navigation?.children ?? []).forEach((action) => {
      expect(action.classList.contains("min-w-0")).toBe(true)
      expect(action.classList.contains("break-words")).toBe(true)
    })
    expect(navigation?.lastElementChild?.classList.contains("min-h-9")).toBe(
      true,
    )
  })

  it("equally distributes contact details without dividers", () => {
    renderFooter()

    const contactGrid = container.querySelector(
      '[data-testid="watch-footer-contact-grid"]',
    )

    expect(contactGrid?.classList.contains("grid")).toBe(true)
    expect(contactGrid?.classList.contains("grid-cols-3")).toBe(true)
    expect(contactGrid?.classList.contains("w-full")).toBe(true)
    expect(contactGrid?.classList.contains("break-words")).toBe(true)
    expect(contactGrid?.children).toHaveLength(3)

    Array.from(contactGrid?.children ?? []).forEach((column) => {
      expect(column.className).not.toContain("border-")
      expect(column.className).not.toContain("max-w-")
    })
  })

  it("omits the resource version from the address column", () => {
    renderFooter()

    const contactGrid = container.querySelector(
      '[data-testid="watch-footer-contact-grid"]',
    )
    const addressColumn = contactGrid?.firstElementChild
    const resourcesLink = container.querySelector(
      'a[href="https://www.jesusfilm.org/partners/resources/"]',
    )

    expect(addressColumn?.textContent).toBe(
      "100 Lake Hart DriveOrlando, FL, 32832",
    )
    expect(addressColumn?.textContent).not.toContain("fea8f46")
    expect(resourcesLink?.textContent).toBe("Resources")
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
