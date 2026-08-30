/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WatchHomeHeroSlide } from "@/lib/watch-home"
import { WatchHomeHero } from "@/components/home/WatchHomeHero"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock("next/image", () => ({
  default: ({ alt, className }: { alt: string; className?: string }) => (
    <span role="img" aria-label={alt} className={className} />
  ),
}))

const fallbackSlide = {
  id: "fallback",
  sourceId: "fallback-source",
  coreId: "fallback-core",
  title: "Jesus",
  label: "Feature film",
  metaLabel: null,
  href: null,
  imageUrl: "https://cdn.example/jesus.jpg",
  blurDataUrl: null,
  dominantColor: null,
  imageAlt: "Jesus still",
  hls: null,
  playbackId: null,
  durationSeconds: null,
  childCount: 0,
  parentCoreId: null,
  parentSlug: null,
  missingData: [],
  eyebrow: "Featured",
} satisfies WatchHomeHeroSlide

describe("WatchHomeHero", () => {
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

  it("keeps the active frame on an unlinked fallback slide", () => {
    act(() => {
      root.render(<WatchHomeHero slides={[fallbackSlide]} />)
    })

    expect(container.querySelector("a")).toBeNull()

    const fallback = container.querySelector<HTMLElement>(
      '[aria-label="Jesus"]',
    )
    expect(fallback?.tagName).toBe("DIV")
    expect(fallback?.className).not.toContain("group")
    expect(fallback?.className).not.toContain("focus-visible:outline-none")

    const frame = fallback?.querySelector<HTMLElement>(
      '[data-testid="watch-home-hero-thumbnail-frame"]',
    )
    const frameClasses = frame?.className ?? ""
    expect(frameClasses).toContain("border-white")
    expect(frameClasses).toContain("opacity-100")
    expect(frameClasses).not.toContain("group-hover:opacity-100")
    expect(frameClasses).not.toContain("group-focus-visible:opacity-100")
  })
})
