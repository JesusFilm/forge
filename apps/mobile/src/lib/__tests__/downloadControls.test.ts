import { controlsForState, decideCancelAction } from "../downloadControls"
import type { OfflineDownloadRecord } from "../offlineManifest"

const rec = (
  state: OfflineDownloadRecord["state"],
  swapFrom: OfflineDownloadRecord["swapFrom"] = null,
): OfflineDownloadRecord => ({
  version: 1,
  videoSlug: "s",
  dubDocumentId: "d",
  renditionDocumentId: "r",
  qualityLabel: "high",
  title: "",
  subtitleLanguageSlug: null,
  state,
  committedPath: null,
  pendingPath: null,
  posterPath: null,
  bytesWritten: 0,
  totalBytes: 0,
  swapFrom,
})

describe("controlsForState (pure control-set mapping)", () => {
  it("downloading → pause + cancel", () => {
    expect(controlsForState("downloading")).toEqual(["pause", "cancel"])
  })

  it("paused → resume + cancel", () => {
    expect(controlsForState("paused")).toEqual(["resume", "cancel"])
  })

  it("queued → cancel only (no live transfer to pause)", () => {
    expect(controlsForState("queued")).toEqual(["cancel"])
  })

  it("downloaded → delete only", () => {
    expect(controlsForState("downloaded")).toEqual(["delete"])
  })

  it("failed → retry + delete (retry first)", () => {
    expect(controlsForState("failed")).toEqual(["retry", "delete"])
  })

  it("canceled → no controls", () => {
    expect(controlsForState("canceled")).toEqual([])
  })
})

describe("decideCancelAction (cancel semantics)", () => {
  it("ignores a completed or absent record (never deletes a finished copy)", () => {
    expect(decideCancelAction(undefined)).toBe("ignore")
    expect(decideCancelAction(rec("downloaded"))).toBe("ignore")
    expect(decideCancelAction(rec("failed"))).toBe("ignore")
  })

  it("reverts an in-flight swap so the old downloaded copy survives", () => {
    const swap = {
      committedPath: "/old",
      renditionDocumentId: "r0",
      qualityLabel: "low",
      subtitleLanguageSlug: null,
      totalBytes: 5,
      posterPath: null,
    }
    expect(decideCancelAction(rec("downloading", swap))).toBe("revert")
  })

  it("removes a fresh in-flight download entirely", () => {
    expect(decideCancelAction(rec("downloading"))).toBe("remove")
    expect(decideCancelAction(rec("queued"))).toBe("remove")
    expect(decideCancelAction(rec("paused"))).toBe("remove")
  })
})
