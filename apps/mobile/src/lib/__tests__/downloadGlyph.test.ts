import {
  DOWNLOAD_DONE_COLOR,
  DOWNLOAD_FAILED_COLOR,
  EXPORT_IN_PROGRESS_COLOR,
  downloadGlyphInfo,
} from "../downloadGlyph"
import { ACCENT_ON_DARK } from "../color"
import type { OfflineDownloadState } from "../offlineManifest"
import type { ExportSessionEntry } from "../exportSession"

const exportEntry = (
  overrides: Partial<ExportSessionEntry> = {},
): ExportSessionEntry => ({
  target: "birth-of-jesus",
  runId: "run-1",
  title: "The Birth of Jesus",
  seriesSlug: null,
  progress: 0.42,
  cancelRequested: false,
  ...overrides,
})

describe("downloadGlyphInfo", () => {
  it("maps null/undefined state to the idle download glyph", () => {
    for (const s of [null, undefined] as const) {
      const g = downloadGlyphInfo(s, null)
      expect(g.inProgress).toBe(false)
      expect(g.icon).toBe("download-outline")
      expect(g.a11yLabel).toBe("Download")
      expect(g.interactive).toBe(true)
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
    expect(g.a11yLabel).toBe("Download queued. Tap to remove")
  })

  it("maps 'paused' to an in-progress ring with the pause glyph", () => {
    const g = downloadGlyphInfo("paused", 0.5)
    expect(g.inProgress).toBe(true)
    expect(g.icon).toBe("pause")
    expect(g.color).toBe(ACCENT_ON_DARK)
    expect(g.a11yLabel).toBe("Download paused. Tap to resume or remove")
  })

  it("labels 'downloading' with null progress without a percentage", () => {
    expect(downloadGlyphInfo("downloading", null).a11yLabel).toBe(
      "Downloading. Tap to pause",
    )
  })

  it("labels 'downloading' with 0 progress without a percentage (not 0%)", () => {
    expect(downloadGlyphInfo("downloading", 0).a11yLabel).toBe(
      "Downloading. Tap to pause",
    )
  })

  it("labels 'downloading' with mid progress as a percentage", () => {
    const g = downloadGlyphInfo("downloading", 0.5)
    expect(g.inProgress).toBe(true)
    expect(g.color).toBe(ACCENT_ON_DARK)
    expect(g.a11yLabel).toBe("Downloading, 50%. Tap to pause")
  })

  it("labels exactly-complete (progress=1) as 100% (boundary)", () => {
    expect(downloadGlyphInfo("downloading", 1).a11yLabel).toBe(
      "Downloading, 100%. Tap to pause",
    )
  })

  it("clamps a >1 progress value to 100%", () => {
    expect(downloadGlyphInfo("downloading", 1.5).a11yLabel).toBe(
      "Downloading, 100%. Tap to pause",
    )
  })

  // The ring IS the control, so its glyph names the tap. These decisions used to
  // live in ActionButtonRow, where they could drift from the label beside them.
  it("names the ring's tap affordance per in-progress state", () => {
    expect(downloadGlyphInfo("paused", 0.5).ringIcon).toBe("play")
    expect(downloadGlyphInfo("queued", 0.5).ringIcon).toBe("arrow-down")
    expect(downloadGlyphInfo("downloading", 0.5).ringIcon).toBe("pause")
  })

  it("carries the ring's own progress, clamped, for an in-progress state", () => {
    expect(downloadGlyphInfo("downloading", 0.25).ringProgress).toBe(0.25)
    expect(downloadGlyphInfo("downloading", null).ringProgress).toBe(0)
    expect(downloadGlyphInfo("downloading", 1.5).ringProgress).toBe(1)
    expect(downloadGlyphInfo("downloading", -1).ringProgress).toBe(0)
  })

  it("keeps every offline state interactive", () => {
    const states: (OfflineDownloadState | null)[] = [
      null,
      "queued",
      "downloading",
      "paused",
      "failed",
      "downloaded",
      "canceled",
    ]
    for (const state of states) {
      expect(downloadGlyphInfo(state, 0.5).interactive).toBe(true)
    }
  })

  describe("raw export (R16, R24)", () => {
    it("shows the export as its own state, distinct from every offline one", () => {
      const g = downloadGlyphInfo(null, null, exportEntry())
      expect(g.inProgress).toBe(true)
      expect(g.icon).toBe("arrow-up")
      expect(g.ringIcon).toBe("arrow-up")
      expect(g.color).toBe(EXPORT_IN_PROGRESS_COLOR)
      expect(g.color).not.toBe(ACCENT_ON_DARK)
      expect(g.ringProgress).toBe(0.42)
    })

    it("names the export in the label and never offers a pause", () => {
      const g = downloadGlyphInfo(null, null, exportEntry())
      expect(g.a11yLabel).toBe("Saving to Photos, 42%")
      expect(g.a11yLabel.toLowerCase()).not.toContain("pause")
      expect(g.interactive).toBe(false)
    })

    it("drops the percentage until the transfer reports one", () => {
      expect(
        downloadGlyphInfo(null, null, exportEntry({ progress: 0 })).a11yLabel,
      ).toBe("Saving to Photos")
    })

    it("clamps an out-of-range export progress", () => {
      expect(
        downloadGlyphInfo(null, null, exportEntry({ progress: 1.5 }))
          .ringProgress,
      ).toBe(1)
      expect(
        downloadGlyphInfo(null, null, exportEntry({ progress: -1 }))
          .ringProgress,
      ).toBe(0)
    })

    it("outranks every offline state, a finished copy included", () => {
      const states: OfflineDownloadState[] = [
        "queued",
        "downloading",
        "paused",
        "failed",
        "downloaded",
        "canceled",
      ]
      for (const state of states) {
        const g = downloadGlyphInfo(state, 0.9, exportEntry())
        expect(g.ringIcon).toBe("arrow-up")
        expect(g.interactive).toBe(false)
        expect(g.ringProgress).toBe(0.42)
      }
    })

    it("returns to the offline state once the export leaves the session", () => {
      for (const absent of [null, undefined] as const) {
        const g = downloadGlyphInfo("downloaded", null, absent)
        expect(g.icon).toBe("checkmark-circle-outline")
        expect(g.interactive).toBe(true)
      }
    })
  })

  it("emits exactly one glyph beyond the five offline ones", () => {
    const states: (OfflineDownloadState | null | undefined)[] = [
      null,
      undefined,
      "queued",
      "downloading",
      "paused",
      "failed",
      "downloaded",
      "canceled",
    ]
    const offline = new Set(states.map((s) => downloadGlyphInfo(s, 0.5).icon))
    expect([...offline].sort()).toEqual([
      "alert-circle-outline",
      "arrow-down",
      "checkmark-circle-outline",
      "download-outline",
      "pause",
    ])
    const withExport = new Set(offline)
    withExport.add(downloadGlyphInfo(null, null, exportEntry()).icon)
    expect(withExport.size).toBe(offline.size + 1)
  })
})
