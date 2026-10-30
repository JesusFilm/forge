import { describe, expect, it } from "vitest"

import {
  bucketDownloads,
  selectDefaultDownloadTier,
  type WatchDownloadOption,
} from "./download-options"

function row(
  quality: string,
  size: number | null,
  overrides: Partial<WatchDownloadOption> = {},
): WatchDownloadOption {
  return {
    documentId: `id-${quality}`,
    capability: `cap-${quality}`,
    height: null,
    quality,
    size,
    ...overrides,
  }
}

const MB = 1024 * 1024

// Exact catalog rows (documentId, quality, height, size) captured from
// production /watch/jesus.html/english.html on 2026-10-10 (FGE-71): eight rows,
// three of them legacy `distro*`. `fhd` and `highest` are the same 1080p
// rendition under two opaque ids. Capabilities are synthetic.
const productionRows = (): WatchDownloadOption[] => [
  row("low", 585287114, {
    documentId: "81641b54-633a-4f3d-823b-688b16683522",
    height: 270,
  }),
  row("high", 2962849007, {
    documentId: "4333520c-5cfb-424e-b9c6-01af7c10c88c",
    height: 720,
  }),
  row("distroHigh", 2358523707, {
    documentId: "ad0453b9-4d91-49e9-ac7a-b3803a13aca2",
    height: 720,
  }),
  row("fhd", 5521959728, {
    documentId: "6948e392-4dce-450a-bd85-fc6e25ee8ad4",
    height: 1080,
  }),
  row("highest", 5521959728, {
    documentId: "42f8999b-845a-4459-9305-91a2dc338776",
    height: 1080,
  }),
  row("sd", 658922306, {
    documentId: "1f4c7004-59e7-4cf4-b4c4-cd05cfb60cfe",
    height: 360,
  }),
  row("distroLow", 207141494, {
    documentId: "6b06b1b9-04c3-4061-967f-19264719baf1",
    height: 240,
  }),
  row("distroSd", 1561752518, {
    documentId: "f077d33c-8f21-4555-be45-f712c824387d",
    height: 480,
  }),
]

const summarize = (downloads: WatchDownloadOption[]) =>
  bucketDownloads(downloads).map((o) => [o.tier, o.download.quality])

describe("bucketDownloads", () => {
  it("never offers distro rows and maps High/Low to the real high/low rows", () => {
    // Size-middle selection used to pick distroSd (High) and distroLow (Low).
    expect(summarize(productionRows())).toEqual([
      ["highest", "fhd"],
      ["high", "high"],
      ["low", "low"],
    ])
  })

  it("ranks by quality, not size: an inflated low row is never Highest or High", () => {
    const downloads = [
      row("low", 9_000 * MB), // misleadingly larger than fhd and high
      row("high", 400 * MB),
      row("fhd", 3_000 * MB),
      row("distroSd", 2_000 * MB), // misleadingly between fhd and high
    ]
    expect(summarize(downloads)).toEqual([
      ["highest", "fhd"],
      ["high", "high"],
      ["low", "low"],
    ])
  })

  it("uses size only to order rows of the same quality", () => {
    const downloads = [
      row("high", 300 * MB, { documentId: "small-high" }),
      row("high", 400 * MB, { documentId: "big-high" }),
      row("low", 9_000 * MB),
    ]
    const tiers = bucketDownloads(downloads)
    expect(tiers.map((o) => o.download.documentId)).toEqual([
      "big-high",
      "small-high",
      "id-low",
    ])
  })

  it("is order independent", () => {
    expect(summarize([...productionRows()].reverse())).toEqual(
      summarize(productionRows()),
    )
  })

  it("falls back to a real lower quality for Low when `low` is missing", () => {
    const downloads = productionRows().filter((d) => d.quality !== "low")
    expect(summarize(downloads)).toEqual([
      ["highest", "fhd"],
      ["high", "high"],
      ["low", "sd"],
    ])
  })

  it("falls back to sd, not the 1080p `highest` alias, when `high` is missing", () => {
    const downloads = productionRows().filter((d) => d.quality !== "high")
    expect(summarize(downloads)).toEqual([
      ["highest", "fhd"],
      ["high", "sd"],
      ["low", "low"],
    ])
  })

  it("keeps the `highest` alias only as a last-resort fallback", () => {
    // fhd + its alias + low: three distinct downloads are preserved, the alias
    // fills High because nothing else real and lower exists.
    expect(
      summarize([row("fhd", 5_000), row("highest", 5_000), row("low", 500)]),
    ).toEqual([
      ["highest", "fhd"],
      ["high", "highest"],
      ["low", "low"],
    ])
    // Two rows: Highest/Low, even when Low can only be the alias.
    expect(summarize([row("fhd", 5_000), row("highest", 5_000)])).toEqual([
      ["highest", "fhd"],
      ["low", "highest"],
    ])
  })

  it("does not treat equal height alone as an alias when falling back", () => {
    // Same 1080 height but different qualities: not assumed identical, so the
    // better-ranked row stays the High fallback instead of sd.
    const downloads = [
      row("qhd", 6_000, { height: 1080 }),
      row("fhd", 5_000, { height: 1080 }),
      row("sd", 500, { height: 360 }),
      row("low", 100, { height: 270 }),
    ]
    expect(summarize(downloads)).toEqual([
      ["highest", "qhd"],
      ["high", "fhd"],
      ["low", "low"],
    ])
  })

  it("keeps three distinct tiers when both `high` and `low` are missing", () => {
    const downloads = [row("fhd", 3_000 * MB), row("sd", 500 * MB)]
    downloads.push(row("qhd", 5_000 * MB, { height: 1440 }))
    expect(summarize(downloads)).toEqual([
      ["highest", "qhd"],
      ["high", "fhd"],
      ["low", "sd"],
    ])
  })

  it("does not reuse the Highest row as High when `high` is the top quality", () => {
    const downloads = [
      row("high", 1_100 * MB),
      row("sd", 550 * MB),
      row("low", 150 * MB),
    ]
    const tiers = bucketDownloads(downloads)
    expect(tiers.map((o) => [o.tier, o.download.quality])).toEqual([
      ["highest", "high"],
      ["high", "sd"],
      ["low", "low"],
    ])
    expect(new Set(tiers.map((o) => o.download.documentId)).size).toBe(3)
  })

  it("offers one tier for one real download and Highest/Low for two", () => {
    expect(
      summarize([row("distroSd", 1_500 * MB), row("high", 1_100 * MB)]),
    ).toEqual([["highest", "high"]])
    expect(
      summarize([
        row("distroHigh", 1_100 * MB),
        row("high", 1_100 * MB),
        row("distroLow", 200 * MB),
        row("low", 150 * MB),
      ]),
    ).toEqual([
      ["highest", "high"],
      ["low", "low"],
    ])
  })

  it("returns no tiers when only distro rows exist", () => {
    const downloads = [
      row("distroHigh", 1_100 * MB),
      row("distroSd", 1_500 * MB),
      row("distroLow", 200 * MB),
    ]
    expect(bucketDownloads(downloads)).toEqual([])
    expect(selectDefaultDownloadTier(downloads)).toBeNull()
  })

  it("returns no tiers for an empty catalog", () => {
    expect(bucketDownloads([])).toEqual([])
  })

  it("keeps unknown-quality rows as fallbacks, ranked below known qualities", () => {
    const downloads = [
      row("mystery", null),
      row("fhd", null),
      row("distroLow", null),
    ]
    expect(summarize(downloads)).toEqual([
      ["highest", "fhd"],
      ["low", "mystery"],
    ])
  })

  it("does not duplicate a download that appears twice with one opaque id", () => {
    const downloads = [row("fhd", 3_000 * MB), row("fhd", 3_000 * MB)]
    expect(summarize(downloads)).toEqual([["highest", "fhd"]])
  })

  it("returns the original rows so opaque ids and capabilities pass through", () => {
    const downloads = productionRows()
    const tiers = bucketDownloads(downloads)
    for (const option of tiers) {
      expect(downloads).toContain(option.download)
      expect(option.download.documentId).toBe(
        productionRows().find((d) => d.quality === option.download.quality)
          ?.documentId,
      )
      expect(option.download.capability).toBe(`cap-${option.download.quality}`)
    }
  })

  it("defaults to Highest, never a distro row", () => {
    expect(selectDefaultDownloadTier(productionRows())).toMatchObject({
      tier: "highest",
      download: { quality: "fhd" },
    })
  })
})
