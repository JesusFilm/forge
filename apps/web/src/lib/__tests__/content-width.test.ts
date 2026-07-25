import { describe, expect, it } from "vitest"

import {
  CAROUSEL_BLEED_CLASSES,
  CAROUSEL_CONTENT_PADDING,
  CAROUSEL_END_SPACER,
  CONTENT_WIDTH_CLASSES,
  FLOATING_HEADER_FIELD_WIDTH_CLASS,
  FLOATING_HEADER_LANGUAGE_SLOT_CLASS,
  FLOATING_HEADER_LAYOUT_CLASS,
  FLOATING_HEADER_LOGO_SLOT_CLASS,
  FLOATING_HEADER_MOBILE_BOUNDARY_HEIGHT_CLASS,
  FLOATING_HEADER_PINNED_TOP_CLASS,
  FLOATING_HEADER_TOP_CLASS,
  FLOATING_HEADER_TRAILING_GROUP_CLASS,
  FLOATING_HEADER_TRAILING_SLOT_CLASS,
  FLOATING_MODAL_HEADER_TRAILING_GROUP_CLASS,
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

  it("keeps floating search header geometry available as one shared contract", () => {
    expect(FLOATING_HEADER_TOP_CLASS).toContain(
      "md:top-[calc(env(safe-area-inset-top,0px)+3rem)]",
    )
    expect(FLOATING_HEADER_PINNED_TOP_CLASS).toContain(
      "md:top-[calc(env(safe-area-inset-top,0px)+1rem)]",
    )
    expect(FLOATING_HEADER_LAYOUT_CLASS).toContain("h-[52px]")
    expect(FLOATING_HEADER_LAYOUT_CLASS).toContain(
      "grid-cols-[minmax(80px,1fr)_minmax(0,800px)_minmax(80px,1fr)]",
    )
    expect(FLOATING_HEADER_LAYOUT_CLASS).toContain(
      "sm:grid-cols-[minmax(112px,1fr)_minmax(0,800px)_minmax(112px,1fr)]",
    )
    expect(FLOATING_HEADER_LAYOUT_CLASS).toContain(
      "md:grid-cols-[minmax(139px,1fr)_minmax(0,800px)_minmax(139px,1fr)]",
    )
    expect(FLOATING_HEADER_FIELD_WIDTH_CLASS).toContain("max-w-[800px]")
    expect(FLOATING_HEADER_MOBILE_BOUNDARY_HEIGHT_CLASS).toBe(
      "h-[calc(env(safe-area-inset-top,0px)+0.75rem+52px+0.75rem)]",
    )
    expect(FLOATING_HEADER_LAYOUT_CLASS).toContain("md:gap-5")
    expect(FLOATING_HEADER_LOGO_SLOT_CLASS).toContain("md:w-12")
    expect(FLOATING_HEADER_TRAILING_GROUP_CLASS).toContain("md:gap-2")
    expect(FLOATING_MODAL_HEADER_TRAILING_GROUP_CLASS).toContain("md:flex")
    expect(FLOATING_HEADER_LANGUAGE_SLOT_CLASS).toContain("md:w-12")
    expect(FLOATING_HEADER_TRAILING_SLOT_CLASS).toContain("md:w-12")
  })
})
