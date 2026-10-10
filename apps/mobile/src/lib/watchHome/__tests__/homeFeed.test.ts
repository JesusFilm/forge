/**
 * feat-517 KTD9: one pure gate decides whether the recommendations feed item
 * exists, and one pure builder places it at the authored position. A closed
 * gate leaves no item and therefore no placeholder, and the rest of the feed
 * is byte-identical to the feed Home built before this feature.
 */

import { assembleWatchHomeModel } from "../experienceAdapter"
import {
  buildHomeFeed,
  recommendationsShelfVisible,
  type HomeFeedItem,
  type RecommendationsGateInput,
} from "../homeFeed"
import type { WatchHomeModel, WatchHomeSection } from "../model"

function section(id: string): WatchHomeSection {
  return {
    id,
    eyebrow: "",
    title: id,
    description: null,
    layout: "rail",
    orientation: "horizontal",
    showSequenceNumbers: false,
    cards: [],
  }
}

function model(sectionCount: number): WatchHomeModel {
  return {
    sections: Array.from({ length: sectionCount }, (_, index) =>
      section(`s${index}`),
    ),
    carousel: { pools: [], muxInserts: [] },
    missingData: [],
  }
}

/** The gate open on every axis; each test closes exactly one. */
function openGate(
  overrides: Partial<RecommendationsGateInput> = {},
): RecommendationsGateInput {
  return { insertIndex: 0, clientEnabled: true, hasBearer: true, ...overrides }
}

/** One readable token per feed item, so an order assertion reads as an order. */
function kinds(items: readonly HomeFeedItem[]): string[] {
  return items.map((item) =>
    item.kind === "section" ? `section:${item.section.id}` : item.kind,
  )
}

describe("recommendationsShelfVisible", () => {
  it("opens when the block is published, the client is on and a bearer is set", () => {
    expect(recommendationsShelfVisible(openGate({ insertIndex: 2 }))).toBe(true)
  })

  it("closes when the Experience publishes no recommendations block", () => {
    expect(recommendationsShelfVisible(openGate({ insertIndex: null }))).toBe(
      false,
    )
  })

  it("closes when the Home body fell back to the config model", () => {
    // KD9 through U2's real contract: a body with no Experience blocks reports
    // a null index, which is the same closed axis the gate reads.
    const resolved = assembleWatchHomeModel({
      configVideos: [],
      hydrationVideos: [],
      blocks: null,
    })
    expect(resolved.recommendationsInsertIndex).toBeNull()
    expect(
      recommendationsShelfVisible(
        openGate({ insertIndex: resolved.recommendationsInsertIndex }),
      ),
    ).toBe(false)
  })

  it("closes when the client kill switch is off (AE9)", () => {
    expect(
      recommendationsShelfVisible(openGate({ clientEnabled: false })),
    ).toBe(false)
  })

  it("closes when no fleet bearer is configured", () => {
    expect(recommendationsShelfVisible(openGate({ hasBearer: false }))).toBe(
      false,
    )
  })
})

describe("buildHomeFeed", () => {
  it("builds nothing before a model lands", () => {
    expect(
      buildHomeFeed({
        model: null,
        showSelector: true,
        recommendations: openGate(),
      }),
    ).toEqual([])
  })

  it("builds today's feed when the block is absent", () => {
    const items = buildHomeFeed({
      model: model(2),
      showSelector: true,
      recommendations: openGate({ insertIndex: null }),
    })
    expect(kinds(items)).toEqual([
      "selector",
      "section:s0",
      "section:s1",
      "mission",
    ])
  })

  it("places the shelf before the first section at index 0", () => {
    const items = buildHomeFeed({
      model: model(2),
      showSelector: true,
      recommendations: openGate({ insertIndex: 0 }),
    })
    expect(kinds(items)).toEqual([
      "selector",
      "recommendations",
      "section:s0",
      "section:s1",
      "mission",
    ])
  })

  it("places the shelf between two sections", () => {
    const items = buildHomeFeed({
      model: model(3),
      showSelector: false,
      recommendations: openGate({ insertIndex: 2 }),
    })
    expect(kinds(items)).toEqual([
      "section:s0",
      "section:s1",
      "recommendations",
      "section:s2",
      "mission",
    ])
  })

  it("places the shelf last when the index equals the section count", () => {
    const items = buildHomeFeed({
      model: model(2),
      showSelector: false,
      recommendations: openGate({ insertIndex: 2 }),
    })
    expect(kinds(items)).toEqual([
      "section:s0",
      "section:s1",
      "recommendations",
      "mission",
    ])
  })

  it("places the shelf last when the index runs past the last section", () => {
    const items = buildHomeFeed({
      model: model(2),
      showSelector: false,
      recommendations: openGate({ insertIndex: 9 }),
    })
    expect(kinds(items)).toEqual([
      "section:s0",
      "section:s1",
      "recommendations",
      "mission",
    ])
  })

  it("places the shelf first when the index is negative", () => {
    // SYNTHETIC input: `buildWatchHomeBodyFromExperience` counts the shelves it
    // emitted before the block, so it never produces a negative index. The case
    // pins the clamp, which is what keeps a bad index from dropping the shelf.
    const items = buildHomeFeed({
      model: model(1),
      showSelector: false,
      recommendations: openGate({ insertIndex: -3 }),
    })
    expect(kinds(items)).toEqual(["recommendations", "section:s0", "mission"])
  })

  it("keeps the shelf out of an empty-section feed's own position", () => {
    const items = buildHomeFeed({
      model: model(0),
      showSelector: false,
      recommendations: openGate({ insertIndex: 0 }),
    })
    expect(kinds(items)).toEqual(["recommendations", "mission"])
  })

  it("omits the selector rail when the hero queue holds one slide", () => {
    const items = buildHomeFeed({
      model: model(1),
      showSelector: false,
      recommendations: openGate({ insertIndex: null }),
    })
    expect(kinds(items)).toEqual(["section:s0", "mission"])
  })

  it.each([
    ["the block is absent", { insertIndex: null }],
    ["the kill switch is off", { clientEnabled: false }],
    ["no bearer is configured", { hasBearer: false }],
  ])("emits no shelf item when %s", (_name, closed) => {
    const items = buildHomeFeed({
      model: model(2),
      showSelector: true,
      recommendations: openGate(closed),
    })
    expect(kinds(items)).toEqual([
      "selector",
      "section:s0",
      "section:s1",
      "mission",
    ])
  })

  it("leaves the rest of the feed untouched when the kill switch is off (AE9)", () => {
    const body = model(2)
    const open = buildHomeFeed({
      model: body,
      showSelector: true,
      recommendations: openGate({ insertIndex: 1 }),
    })
    const off = buildHomeFeed({
      model: body,
      showSelector: true,
      recommendations: openGate({ insertIndex: 1, clientEnabled: false }),
    })
    expect(open.filter((item) => item.kind !== "recommendations")).toEqual(off)
  })
})
