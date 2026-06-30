import { describe, expect, it } from "vitest"

import {
  CAROUSEL_BLEED_CLASSES,
  CAROUSEL_CONTENT_PADDING,
  CAROUSEL_END_SPACER,
  CONTENT_WIDTH_CLASSES,
  SEARCH_OVERLAY_FIELD_WIDTH_CLASSES,
  WATCH_PAGE_CONTENT_CLASSES,
  WATCH_PAGE_LEFT_EDGE_CLASSES,
  WATCH_PAGE_LEFT_RAIL_CLASSES,
  WATCH_PAGE_RAIL_PADDING_CLASSES,
  WATCH_PAGE_RIGHT_EDGE_CLASSES,
} from "@/lib/content-width"

// Lockstep invariant: at every breakpoint, the negative bleed margin, the
// carousel content's padding-left, and the trailing spacer's width must all
// match the section's outer horizontal padding. A drift between any of these
// four ladders silently misaligns the first card with the section header.
//
// Each tuple captures the matching px-N tokens, with the first entry being
// the unprefixed (base / mobile) value.
const BREAKPOINT_TUPLES: Array<{
  prefix: string | null
  contentPx: string
  bleedMx: string
  carouselPl: string
  spacerW: string
}> = [
  {
    prefix: null,
    contentPx: "px-4",
    bleedMx: "-mx-4",
    carouselPl: "pl-4",
    spacerW: "w-4",
  },
  {
    prefix: "sm",
    contentPx: "px-6",
    bleedMx: "-mx-6",
    carouselPl: "pl-6",
    spacerW: "w-6",
  },
  {
    prefix: "lg",
    contentPx: "px-8",
    bleedMx: "-mx-8",
    carouselPl: "pl-8",
    spacerW: "w-8",
  },
  {
    prefix: "xl",
    contentPx: "px-10",
    bleedMx: "-mx-10",
    carouselPl: "pl-10",
    spacerW: "w-10",
  },
  {
    prefix: "2xl",
    contentPx: "px-12",
    bleedMx: "-mx-12",
    carouselPl: "pl-12",
    spacerW: "w-12",
  },
]

function withPrefix(prefix: string | null, token: string): string {
  return prefix ? `${prefix}:${token}` : token
}

describe("content-width.ts — bleed/padding lockstep", () => {
  for (const tuple of BREAKPOINT_TUPLES) {
    const label = tuple.prefix ?? "base"

    it(`${label}: CONTENT_WIDTH_CLASSES carries ${withPrefix(tuple.prefix, tuple.contentPx)}`, () => {
      expect(CONTENT_WIDTH_CLASSES).toContain(
        withPrefix(tuple.prefix, tuple.contentPx),
      )
    })

    it(`${label}: CAROUSEL_BLEED_CLASSES carries ${withPrefix(tuple.prefix, tuple.bleedMx)}`, () => {
      expect(CAROUSEL_BLEED_CLASSES).toContain(
        withPrefix(tuple.prefix, tuple.bleedMx),
      )
    })

    it(`${label}: CAROUSEL_CONTENT_PADDING carries ${withPrefix(tuple.prefix, tuple.carouselPl)}`, () => {
      expect(CAROUSEL_CONTENT_PADDING).toContain(
        withPrefix(tuple.prefix, tuple.carouselPl),
      )
    })

    it(`${label}: CAROUSEL_END_SPACER carries ${withPrefix(tuple.prefix, tuple.spacerW)}`, () => {
      expect(CAROUSEL_END_SPACER).toContain(
        withPrefix(tuple.prefix, tuple.spacerW),
      )
    })
  }
})

describe("content-width.ts — watch page rail lockstep", () => {
  const rails = [
    { padding: "px-5", left: "left-5" },
    { padding: "md:px-16", left: "md:left-16" },
    { padding: "xl:px-24", left: "xl:left-24" },
  ]

  for (const rail of rails) {
    it(`${rail.padding} aligns with ${rail.left}`, () => {
      expect(WATCH_PAGE_RAIL_PADDING_CLASSES).toContain(rail.padding)
      expect(WATCH_PAGE_CONTENT_CLASSES).toContain(rail.padding)
      expect(WATCH_PAGE_LEFT_RAIL_CLASSES).toContain(rail.left)
    })
  }

  it("clamps fixed edge header chrome to the 1920px watch frame on wide screens", () => {
    expect(WATCH_PAGE_LEFT_EDGE_CLASSES).toContain(
      "xl:left-[max(6rem,calc((100vw-1920px)/2+6rem))]",
    )
    expect(WATCH_PAGE_RIGHT_EDGE_CLASSES).toContain(
      "xl:right-[max(6rem,calc((100vw-1920px)/2+6rem))]",
    )
  })

  it("keeps the search overlay field capped to the shared desktop width", () => {
    expect(SEARCH_OVERLAY_FIELD_WIDTH_CLASSES).toContain("max-w-[810px]")
    expect(SEARCH_OVERLAY_FIELD_WIDTH_CLASSES).toContain("mx-auto")
    expect(SEARCH_OVERLAY_FIELD_WIDTH_CLASSES).toContain("w-full")
  })
})
