import {
  resolveFromMedia,
  selectRendition,
  selectSubtitle,
  type DesiredDownload,
} from "../downloadUrlResolution"
import type {
  VariantMedia,
  WatchDownload,
  WatchSubtitle,
} from "../normalizeVideo"

function download(
  documentId: string,
  quality: string,
  size: string,
): WatchDownload {
  return {
    documentId,
    quality,
    size,
    url: `https://cdn/${documentId}.mp4?sig=x`,
  }
}

function subtitle(languageSlug: string): WatchSubtitle {
  return {
    documentId: `sub-${languageSlug}`,
    languageSlug,
    languageName: languageSlug,
    languageBcp47: languageSlug,
    vttSrc: `https://cdn/${languageSlug}.vtt?sig=x`,
    primary: false,
    aiGenerated: false,
  }
}

const DOWNLOADS: WatchDownload[] = [
  download("rend-high", "High", "400000000"),
  download("rend-low", "Low", "120000000"),
]

const MEDIA: VariantMedia = {
  downloads: DOWNLOADS,
  subtitles: [subtitle("english"), subtitle("tagalog")],
}

const DESIRED: DesiredDownload = {
  renditionDocumentId: "rend-high",
  qualityLabel: "High",
  totalBytes: 400_000_000,
  subtitleLanguageSlug: "english",
}

describe("selectRendition", () => {
  it("selects by exact rendition documentId", () => {
    expect(selectRendition(DOWNLOADS, DESIRED)?.documentId).toBe("rend-high")
  })

  it("falls back to quality label when the documentId is gone", () => {
    const out = selectRendition(DOWNLOADS, {
      ...DESIRED,
      renditionDocumentId: "rend-vanished",
    })
    expect(out?.quality).toBe("High")
  })

  it("falls back to nearest size when id and quality are both gone", () => {
    const out = selectRendition(DOWNLOADS, {
      ...DESIRED,
      renditionDocumentId: "gone",
      qualityLabel: "Medium",
      totalBytes: 130_000_000, // closest to the 120MB "Low"
    })
    expect(out?.documentId).toBe("rend-low")
  })

  it("returns null only when there are no downloads", () => {
    expect(selectRendition([], DESIRED)).toBeNull()
  })

  it("does not mutate or throw on a frozen (Apollo-cached) downloads array", () => {
    const frozen = Object.freeze([
      download("a", "A", "300"),
      download("b", "B", "100"),
    ])
    expect(() =>
      selectRendition(frozen, {
        ...DESIRED,
        renditionDocumentId: "gone",
        qualityLabel: "gone",
        totalBytes: 90,
      }),
    ).not.toThrow()
  })
})

describe("selectSubtitle", () => {
  it("returns the vtt url for a matching language slug", () => {
    expect(selectSubtitle(MEDIA, "english")).toEqual({
      url: "https://cdn/english.vtt?sig=x",
      missing: false,
    })
  })

  it("returns no subtitle for a null slug (No subtitles)", () => {
    expect(selectSubtitle(MEDIA, null)).toEqual({ url: null, missing: false })
  })

  it("flags missing when the requested slug is absent", () => {
    expect(selectSubtitle(MEDIA, "korean")).toEqual({
      url: null,
      missing: true,
    })
  })
})

describe("resolveFromMedia", () => {
  it("resolves fresh media + subtitle urls from fetched media", () => {
    expect(resolveFromMedia(MEDIA, DESIRED)).toEqual({
      kind: "resolved",
      mediaUrl: "https://cdn/rend-high.mp4?sig=x",
      renditionDocumentId: "rend-high",
      qualityLabel: "High",
      subtitleUrl: "https://cdn/english.vtt?sig=x",
      subtitleMissing: false,
    })
  })

  it("reports empty when the dub exposes no renditions (terminal)", () => {
    expect(resolveFromMedia({ downloads: [], subtitles: [] }, DESIRED)).toEqual(
      { kind: "empty" },
    )
  })

  it("degrades to no-subtitle and reports when the chosen subtitle is gone", () => {
    const out = resolveFromMedia(MEDIA, {
      ...DESIRED,
      subtitleLanguageSlug: "korean",
    })
    expect(out).toMatchObject({
      kind: "resolved",
      subtitleUrl: null,
      subtitleMissing: true,
    })
  })
})
