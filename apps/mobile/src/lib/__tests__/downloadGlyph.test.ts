import {
  DOWNLOAD_DONE_COLOR,
  DOWNLOAD_FAILED_COLOR,
  downloadGlyphInfo,
} from "../downloadGlyph"
import { ACCENT_ON_DARK } from "../color"

describe("downloadGlyphInfo", () => {
  it("maps null/undefined state to the idle download glyph", () => {
    for (const s of [null, undefined] as const) {
      const g = downloadGlyphInfo(s, null)
      expect(g.inProgress).toBe(false)
      expect(g.icon).toBe("download-outline")
      expect(g.a11yLabel).toBe("Download")
    }
  })

  it("falls 'canceled' through to the idle glyph (default branch)", () => {
    const g = downloadGlyphInfo("canceled", null)
    expect(g.inProgress).toBe(false)
    expect(g.icon).toBe("download-outline")
    expect(g.a11yLabel).toBe("Download")
  })

  it("maps 'downloaded' to the green tick", () => {
    const g = downloadGlyphInfo("downloaded", null)
    expect(g.inProgress).toBe(false)
    expect(g.icon).toBe("checkmark-circle-outline")
    expect(g.color).toBe(DOWNLOAD_DONE_COLOR)
    expect(g.a11yLabel).toBe("Downloaded")
  })

  it("maps 'failed' to the retry glyph", () => {
    const g = downloadGlyphInfo("failed", null)
    expect(g.inProgress).toBe(false)
    expect(g.icon).toBe("alert-circle-outline")
    expect(g.color).toBe(DOWNLOAD_FAILED_COLOR)
    expect(g.a11yLabel).toBe("Download failed, retry")
  })

  it("maps 'queued' to an in-progress ring with a queued label", () => {
    const g = downloadGlyphInfo("queued", 0.5)
    expect(g.inProgress).toBe(true)
    expect(g.icon).toBe("arrow-down")
    expect(g.color).toBe(ACCENT_ON_DARK)
    expect(g.a11yLabel).toBe("Download queued")
  })

  it("maps 'paused' to an in-progress ring with the pause glyph", () => {
    const g = downloadGlyphInfo("paused", 0.5)
    expect(g.inProgress).toBe(true)
    expect(g.icon).toBe("pause")
    expect(g.color).toBe(ACCENT_ON_DARK)
    expect(g.a11yLabel).toBe("Download paused")
  })

  it("labels 'downloading' with null progress as 'Downloading'", () => {
    expect(downloadGlyphInfo("downloading", null).a11yLabel).toBe("Downloading")
  })

  it("labels 'downloading' with 0 progress as 'Downloading' (not 0%)", () => {
    expect(downloadGlyphInfo("downloading", 0).a11yLabel).toBe("Downloading")
  })

  it("labels 'downloading' with mid progress as a percentage", () => {
    const g = downloadGlyphInfo("downloading", 0.5)
    expect(g.inProgress).toBe(true)
    expect(g.color).toBe(ACCENT_ON_DARK)
    expect(g.a11yLabel).toBe("Downloading, 50%")
  })

  it("labels exactly-complete (progress=1) as 100% (boundary)", () => {
    expect(downloadGlyphInfo("downloading", 1).a11yLabel).toBe(
      "Downloading, 100%",
    )
  })

  it("clamps a >1 progress value to 100%", () => {
    expect(downloadGlyphInfo("downloading", 1.5).a11yLabel).toBe(
      "Downloading, 100%",
    )
  })
})
