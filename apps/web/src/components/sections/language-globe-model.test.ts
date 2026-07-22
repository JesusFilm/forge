import { describe, expect, it } from "vitest"

import type {
  WatchLanguageGlobeLocation,
  WatchLanguageIndexLanguage,
} from "@/lib/language-index"
import { selectLanguageGlobeEntries } from "./language-globe-model"
import {
  projectGlobePoint,
  visibleProjectedLabelIndexes,
} from "./language-globe-projection"

function language(
  englishLabel: string,
  speakerCount: number,
  places: Array<{
    latitude: number
    longitude: number
    regionName: string
  }> = [],
): WatchLanguageIndexLanguage {
  return {
    id: englishLabel,
    coreId: null,
    englishLabel,
    nativeLabel: `${englishLabel} native`,
    publicSlug: englishLabel.toLowerCase(),
    href: `/${englishLabel.toLowerCase()}.html/videos`,
    bcp47: null,
    speakerCount,
    regionNames: [...new Set(places.map((place) => place.regionName))],
    flagPngSrc: null,
  }
}

function locations(
  englishLabel: string,
  speakerCount: number,
  places: Array<
    Pick<WatchLanguageGlobeLocation, "latitude" | "longitude" | "regionName">
  >,
): WatchLanguageGlobeLocation[] {
  return places.map((place, index) => ({
    ...place,
    countryId: `${englishLabel}-${index}`,
    countryName: `${englishLabel} ${index}`,
    speakers: speakerCount,
    primary: index === 0,
    suggested: index === 0,
    order: index,
  }))
}

describe("language globe model", () => {
  it("orders by speakers then English label and clamps to four entries", () => {
    const entries = selectLanguageGlobeEntries(
      [language("Zulu", 1), language("Beta", 2), language("Alpha", 2)],
      1,
    )
    expect(entries.map((entry) => entry.englishLabel)).toEqual([
      "Alpha",
      "Beta",
      "Zulu",
    ])
  })

  it("keeps coordinate-less languages in the semantic list", () => {
    expect(
      selectLanguageGlobeEntries([language("French", 4)], 12)[0],
    ).toMatchObject({
      nativeLabel: "French native",
      englishLabel: "French",
      href: "/french.html/videos",
      latitude: null,
      longitude: null,
    })
  })

  it("uses a separated candidate from a new region when available", () => {
    const first = language("First", 10, [
      { latitude: 0, longitude: 0, regionName: "A" },
    ])
    const second = language("Second", 9, [
      { latitude: 1, longitude: 1, regionName: "A" },
      { latitude: 30, longitude: 30, regionName: "B" },
    ])
    const entries = selectLanguageGlobeEntries([first, second], 12, {
      first: locations("First", 10, [
        { latitude: 0, longitude: 0, regionName: "A" },
      ]),
      second: locations("Second", 9, [
        { latitude: 1, longitude: 1, regionName: "A" },
        { latitude: 30, longitude: 30, regionName: "B" },
      ]),
    })
    expect(entries[1]).toMatchObject({ latitude: 30, longitude: 30 })
  })
})

describe("language globe projection", () => {
  it("distinguishes front and rear hemisphere points", () => {
    expect(
      projectGlobePoint({ latitude: 0, longitude: 0, rotation: 0, radius: 100 })
        .frontFacing,
    ).toBe(true)
    expect(
      projectGlobePoint({
        latitude: 0,
        longitude: 180,
        rotation: 0,
        radius: 100,
      }).frontFacing,
    ).toBe(false)
  })

  it("keeps labels aligned with the shader rotation", () => {
    const point = projectGlobePoint({
      latitude: 0,
      longitude: 90,
      rotation: Math.PI / 2,
      radius: 100,
    })
    expect(point.x).toBeCloseTo(0)
    expect(point.depth).toBeCloseTo(1)
  })

  it("keeps the higher-ranked colliding label", () => {
    const visible = visibleProjectedLabelIndexes([
      { x: 0, y: 0, depth: 1, frontFacing: true, width: 100, height: 50 },
      { x: 10, y: 10, depth: 0.9, frontFacing: true, width: 100, height: 50 },
      { x: 200, y: 0, depth: 0.8, frontFacing: true, width: 100, height: 50 },
    ])
    expect([...visible]).toEqual([0, 2])
  })
})
