/**
 * @vitest-environment jsdom
 *
 * Pins one prefetching Link per destination in a Watch home section
 * (FGE-209 / feat-634).
 *
 * The section's "Watch" CTA reuses the first linked card's href, so the CTA
 * and that card always point at the same page. `next/link` strips `prefetch`
 * before spreading onto the anchor, so this suite mocks it to stamp
 * `data-prefetch`; otherwise dropping `prefetch={false}` from the CTA would
 * pass every other test.
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "../../../../messages/en.json"

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: {
    href: string
    prefetch?: boolean
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}))

import { NextIntlClientProvider } from "next-intl"

import type { WatchHomeCard } from "@/lib/watch-home"
import { WatchHomeSection } from "../WatchHomeSection"

function makeCard(overrides: Partial<WatchHomeCard> = {}): WatchHomeCard {
  return {
    id: "card-1",
    sourceId: "1_jf-0-0",
    coreId: "1_jf-0-0",
    title: "Jesus",
    label: "Feature film",
    videoLabel: "SEGMENT",
    metaLabel: "2:03",
    href: "/jesus.html",
    imageUrl: "https://cdn.example/jesus.jpg",
    blurDataUrl: null,
    dominantColor: null,
    imageAlt: "Jesus still",
    hls: null,
    playbackId: null,
    durationSeconds: 123,
    childCount: 0,
    parentCoreId: null,
    parentSlug: null,
    missingData: [],
    ...overrides,
  }
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

function renderSection(cards: WatchHomeCard[]) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <WatchHomeSection
          section={{
            id: "home-video-gospels",
            eyebrow: "Video Bible",
            title: "Gospels",
            description: null,
            layout: "rail",
            orientation: "vertical",
            showSequenceNumbers: false,
            cards,
          }}
        />
      </NextIntlClientProvider>,
    )
  })
  return [...container.querySelectorAll("a[href]")]
}

describe("WatchHomeSection prefetch posture", () => {
  it("leaves one prefetching Link per href when the CTA repeats a card destination", () => {
    const links = renderSection([
      makeCard({ id: "a", title: "Matthew", href: "/matthew.html" }),
      makeCard({ id: "b", title: "Mark", href: "/mark.html" }),
    ])

    // Visible output is unchanged: CTA first, then both cards, in order.
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/matthew.html",
      "/matthew.html",
      "/mark.html",
    ])

    const [cta, firstCard, secondCard] = links
    expect(cta?.textContent).toBe(enMessages.WatchHome.watch)
    expect(cta?.getAttribute("data-prefetch")).toBe("false")
    // "undefined" is the default strategy: the cards own their prefetch.
    expect(firstCard?.getAttribute("data-prefetch")).toBe("undefined")
    expect(secondCard?.getAttribute("data-prefetch")).toBe("undefined")

    const prefetchingHrefs = links
      .filter((link) => link.getAttribute("data-prefetch") !== "false")
      .map((link) => link.getAttribute("href"))
    expect(new Set(prefetchingHrefs).size).toBe(prefetchingHrefs.length)
  })
})
