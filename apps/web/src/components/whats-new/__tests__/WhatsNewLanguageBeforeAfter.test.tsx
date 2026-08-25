/**
 * @vitest-environment jsdom
 */

import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ENGLISH_ASSIST_COPY } from "@/components/watch-language-inventory/english-assist"
import { WhatsNewLanguageBeforeAfter } from "@/components/whats-new/WhatsNewLanguageBeforeAfter"
import { WHATS_NEW_BEFORE_AFTER } from "@/components/whats-new/whats-new-content"

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: { children: ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock("next/image", () => ({
  // `createElement` rather than JSX: an `<img>` literal trips
  // `@next/next/no-img-element`, which is not resolvable when lint-staged
  // runs eslint on this file outside the app's Next config.
  default: ({
    alt,
    src,
    width,
    height,
    sizes,
    className,
  }: {
    alt: string
    src: string
    width: number
    height: number
    sizes?: string
    className?: string
  }) =>
    createElement("img", {
      alt,
      src,
      width,
      height,
      className,
      "data-sizes": sizes,
    }),
}))

let container: HTMLDivElement
let root: Root

const panels = () => [
  ...container.querySelectorAll<HTMLElement>(
    '[data-testid="whats-new-before-after-panel"]',
  ),
]
const chips = () => [
  ...container.querySelectorAll<HTMLElement>(
    '[data-testid="whats-new-assist-chip"]',
  ),
]
const links = () => [
  ...container.querySelectorAll<HTMLAnchorElement>(
    '[data-testid="whats-new-before-after-link"]',
  ),
]

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <WhatsNewLanguageBeforeAfter
        bodyClass="body"
        contentClass="rail"
        eyebrowClass="eyebrow"
        headingClass="heading"
        listClass="list"
      />,
    )
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe("WhatsNewLanguageBeforeAfter", () => {
  it("anchors the section at the id the on-page nav links to", () => {
    expect(container.querySelector("section#language")).not.toBeNull()
  })

  it("shows the archived page and the live page as two panels, in that order", () => {
    expect(panels().map((panel) => panel.dataset.panel)).toEqual([
      "before",
      "after",
    ])

    for (const [index, panel] of panels().entries()) {
      const source = WHATS_NEW_BEFORE_AFTER.panels[index]
      expect(panel.textContent).toContain(source.badge)
      expect(panel.textContent).toContain(source.title)
      expect(panel.textContent).toContain(source.note)
    }
  })

  it("states the shared address once, so the comparison is of one page", () => {
    const address = container.querySelector(
      '[data-testid="whats-new-before-after-address"]',
    )
    expect(address?.textContent).toContain(WHATS_NEW_BEFORE_AFTER.address)
    expect(
      container.querySelectorAll(
        '[data-testid="whats-new-before-after-address"]',
      ),
    ).toHaveLength(1)
  })

  it("shows a real screenshot per panel, sized so neither shifts the page", () => {
    const shots = [
      ...container.querySelectorAll<HTMLImageElement>(
        '[data-testid="whats-new-before-after-shot"] img',
      ),
    ]
    expect(shots).toHaveLength(WHATS_NEW_BEFORE_AFTER.panels.length)

    for (const [index, shot] of shots.entries()) {
      const source = WHATS_NEW_BEFORE_AFTER.panels[index].shot
      expect(shot.getAttribute("src")).toBe(source.src)
      // Intrinsic dimensions are what reserves the box before the bytes
      // land; without them these two large shots reflow the section.
      expect(shot.getAttribute("width")).toBe(String(source.width))
      expect(shot.getAttribute("height")).toBe(String(source.height))
      expect(shot.getAttribute("data-sizes")).toBeTruthy()
    }
  })

  it("names in alt text every label the captions argue from", () => {
    // The captions reason about words that exist only inside the
    // pictures. For a reader who cannot see them, `alt` is the only route
    // to that evidence — an alt that merely says "screenshot of a page"
    // leaves the whole argument unsupported.
    const mustName: Record<string, readonly string[]> = {
      before: [
        "JESUS",
        "Play",
        "128 min",
        "DESCRIPTION",
        "DISCUSSION QUESTIONS",
        "Download",
        "اللغة العربية",
        "left to right",
      ],
      after: [
        "يسوع",
        "شاهد الآن",
        "مشاركة",
        "2,285 لغة",
        "61 فصل",
        "تنزيل",
        "right-to-left",
      ],
    }

    for (const panel of WHATS_NEW_BEFORE_AFTER.panels) {
      for (const label of mustName[panel.id]) {
        expect(panel.shot.alt, `${panel.id}: ${label}`).toContain(label)
      }
    }
  })

  it("annotates every localized chip with the English the product actually ships", () => {
    const rows = WHATS_NEW_BEFORE_AFTER.missionaries.rows
    expect(chips()).toHaveLength(rows.length)

    for (const [index, chip] of chips().entries()) {
      const english = ENGLISH_ASSIST_COPY[rows[index].token]

      // Pinned to the inventory's own constant, so this demonstration
      // cannot go on describing a tooltip the product has stopped
      // rendering — and cannot be satisfied by an empty attribute or by
      // echoing the localized label back.
      expect(english).not.toBe("")
      expect(english).not.toBe(rows[index].label)
      expect(chip.getAttribute("title")).toBe(english)
      expect(chip.textContent).toContain(rows[index].label)
    }
  })

  it("uses the browser's own tooltip, and still reaches readers who cannot hover", () => {
    // `title` IS the shipped mechanism — a custom overlay here would
    // demonstrate something the language pages do not do. But `title` is
    // not announced on keyboard focus, so the English is carried in a
    // visually hidden span as well.
    for (const [index, chip] of chips().entries()) {
      const english =
        ENGLISH_ASSIST_COPY[
          WHATS_NEW_BEFORE_AFTER.missionaries.rows[index].token
        ]
      expect(chip.querySelector(".sr-only")?.textContent).toContain(english)

      // Right-to-left labels need `dir` as well as `lang` inside this
      // left-to-right page, or their own digits and punctuation reorder.
      const label = chip.querySelector<HTMLElement>("[lang]")
      expect(label?.lang).toBe(WHATS_NEW_BEFORE_AFTER.missionaries.lang)
      expect(label?.dir).toBe(WHATS_NEW_BEFORE_AFTER.missionaries.dir)
    }
  })

  it("links out to the capture it quotes and to the live pages it describes", () => {
    const hrefs = links().map((link) => link.getAttribute("href"))

    // The archive link is pinned to one capture: the panel transcribes
    // that snapshot, so a bare wayback URL that redirects elsewhere would
    // no longer be evidence for it.
    expect(hrefs).toContain(
      "https://web.archive.org/web/20241116160206/https://www.jesusfilm.org/watch/jesus.html/arabic-modern-standard.html",
    )
    // On-site destinations come from the route builders, not literals.
    expect(hrefs).toContain("/jesus.html/arabic-modern-standard.html")
    expect(hrefs).toContain("/arabic-modern-standard.html/videos")

    const archive = links().find((link) =>
      link.href.includes("web.archive.org"),
    )
    expect(archive?.getAttribute("rel")).toBe("noreferrer")
    expect(archive?.getAttribute("target")).toBe("_blank")
  })

  it("keeps the dual-language idea separate from the tooltip that already exists", () => {
    const shipped = container.querySelector<HTMLElement>(
      '[data-testid="whats-new-assist-chips"]',
    )
    const considered = container.querySelector<HTMLElement>(
      '[data-testid="whats-new-dual-language"]',
    )

    expect(shipped).not.toBeNull()
    expect(considered?.textContent).toContain(
      WHATS_NEW_BEFORE_AFTER.dualLanguage.heading,
    )
    expect(considered?.textContent).toContain(
      WHATS_NEW_BEFORE_AFTER.dualLanguage.eyebrow,
    )
    // The idea must not be nested inside the block demonstrating the
    // shipped tooltip, or the two read as one promise.
    expect(shipped?.contains(considered!)).toBe(false)
  })

  it("renders the seeker argument and every reason under it", () => {
    const text = container.textContent ?? ""
    for (const paragraph of WHATS_NEW_BEFORE_AFTER.seekers.paragraphs) {
      expect(text).toContain(paragraph)
    }
    for (const point of WHATS_NEW_BEFORE_AFTER.seekers.points) {
      expect(text).toContain(point)
    }
    expect(text).toContain(WHATS_NEW_BEFORE_AFTER.seekers.closing)
  })
})
