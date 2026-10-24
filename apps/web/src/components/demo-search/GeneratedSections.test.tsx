// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/image", () => ({ default: () => null }))

import { GeneratedSection } from "@/components/demo-search/GeneratedSections"
import type { SearchResult } from "@/lib/search"

function result(slug: string): SearchResult {
  return {
    type: "video",
    id: slug,
    slug,
    title: `Video ${slug}`,
    imageUrl: null,
    imageBlurDataUrl: null,
    muxThumbnailBlurDataUrl: null,
    snippet: "A video",
    startSeconds: null,
    playbackId: null,
    score: 1,
    label: "SHORT_FILM",
    durationSeconds: 60,
    childCount: 0,
  }
}

describe("GeneratedSection video thumbnails", () => {
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

  it("uses the shared frame for spotlight and theme video links", () => {
    const spotlight = result("spotlight")
    const theme = result("theme")
    const resultsBySlug = new Map([
      [spotlight.slug, spotlight],
      [theme.slug, theme],
    ])

    act(() => {
      root.render(
        <>
          <GeneratedSection
            section={{
              type: "spotlight",
              videoSlug: spotlight.slug,
              why: "Featured",
            }}
            resultsBySlug={resultsBySlug}
          />
          <GeneratedSection
            section={{
              type: "theme-carousel",
              theme: "Hope",
              videoSlugs: [theme.slug],
              caption: "Related videos",
            }}
            resultsBySlug={resultsBySlug}
          />
        </>,
      )
    })

    for (const testId of [
      "generated-spotlight-thumbnail-frame",
      "generated-theme-thumbnail-frame",
    ]) {
      const frame = container.querySelector<HTMLElement>(
        `[data-testid="${testId}"]`,
      )
      const link = frame?.closest("a")

      expect(link?.className).toContain("group")
      expect(link?.className).toContain("focus-visible:outline-none")
      expect(frame?.className).toContain("border-4")
      expect(frame?.className).toContain("border-white")
      expect(frame?.className).toContain("group-hover:opacity-100")
      expect(frame?.className).toContain("group-focus-visible:opacity-100")
    }
  })
})
