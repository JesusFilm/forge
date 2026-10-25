import english from "../../../messages/en.json"
import {
  QUALITY_TIERS,
  formatFileSize,
  formatTierSize,
  tierDownloads,
} from "../downloadTiers"
import type { WatchDownload } from "../normalizeVideo"

// KTD15: a tier is an identifier. Its text lives in the catalog, keyed by the
// same identifier, so every tier has text and no text is logic.
describe("QUALITY_TIERS", () => {
  it("lists identifiers in quality order", () => {
    expect(QUALITY_TIERS).toEqual(["highest", "high", "low"])
  })

  it("has exactly one English catalog message per tier", () => {
    expect(Object.keys(english.DownloadQuality)).toEqual([...QUALITY_TIERS])
  })
})

const dl = (size: string): WatchDownload => ({
  documentId: `d-${size}`,
  quality: "q",
  size,
  url: `u-${size}`,
})

describe("formatFileSize", () => {
  it("renders MB below the GB threshold", () => {
    expect(formatFileSize(String(5 * 1048576))).toBe("5.0 MB")
  })

  it("renders GB at and above 1024 MB", () => {
    expect(formatFileSize(String(2 * 1024 * 1048576))).toBe("2.0 GB")
  })

  it("returns Unknown for zero, negative, and non-numeric input", () => {
    expect(formatFileSize("0")).toBe("Unknown")
    expect(formatFileSize("-5")).toBe("Unknown")
    expect(formatFileSize("not-a-number")).toBe("Unknown")
  })
})

describe("formatTierSize", () => {
  it("renders an exact total when not a lower bound", () => {
    expect(formatTierSize({ bytes: 5 * 1048576, isLowerBound: false })).toBe(
      "5.0 MB",
    )
  })

  it("marks a partial lower-bound total approximate so it never reads exact", () => {
    expect(formatTierSize({ bytes: 5 * 1048576, isLowerBound: true })).toBe(
      "~5.0 MB",
    )
  })

  it("stays 'Unknown' (no ~) when the whole tier is unsized", () => {
    expect(formatTierSize({ bytes: 0, isLowerBound: true })).toBe("Unknown")
  })
})

describe("tierDownloads", () => {
  it("returns an empty array for no downloads", () => {
    expect(tierDownloads([])).toEqual([])
  })

  it("labels a single rendition Highest", () => {
    expect(tierDownloads([dl("1000")]).map((t) => t.tier)).toEqual(["highest"])
  })

  it("labels two renditions Highest and Low by descending size", () => {
    const tiers = tierDownloads([dl("1000"), dl("3000")])
    expect(tiers.map((t) => t.tier)).toEqual(["highest", "low"])
    expect(tiers[0].size).toBe("3000")
  })

  it("labels three-plus renditions Highest, High, Low", () => {
    const tiers = tierDownloads([dl("1000"), dl("3000"), dl("2000")])
    expect(tiers.map((t) => t.tier)).toEqual(["highest", "high", "low"])
  })

  it("does not mutate the input array (copy-before-sort)", () => {
    const input = [dl("1000"), dl("3000")]
    const order = input.map((d) => d.size)
    tierDownloads(input)
    expect(input.map((d) => d.size)).toEqual(order)
  })
})
