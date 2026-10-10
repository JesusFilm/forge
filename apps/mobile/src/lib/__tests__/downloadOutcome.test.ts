import {
  classifyInterruption,
  resolveBundle,
  type BundleParts,
  type TransferInterruption,
} from "../downloadOutcome"

describe("classifyInterruption", () => {
  it.each<TransferInterruption>([
    { kind: "connectivity" },
    { kind: "wifiOnlyOnCellular" },
    { kind: "backgroundedTransient" },
  ])("pauses and keeps bytes for self-healing cause %p", (interruption) => {
    expect(classifyInterruption(interruption)).toEqual({
      state: "paused",
      keepBytes: true,
    })
  })

  it.each<TransferInterruption>([
    { kind: "httpError", status: 404 },
    { kind: "httpError", status: 403 },
    { kind: "integrity" },
    { kind: "storageFull" },
  ])("fails but keeps bytes for retry on terminal cause %p", (interruption) => {
    expect(classifyInterruption(interruption)).toEqual({
      state: "failed",
      keepBytes: true,
    })
  })

  it("cancels and removes bytes on user cancel", () => {
    expect(classifyInterruption({ kind: "userCancel" })).toEqual({
      state: "canceled",
      keepBytes: false,
    })
  })
})

describe("resolveBundle", () => {
  const base: BundleParts = {
    mediaVerified: true,
    subtitleRequested: false,
    subtitleVerified: false,
    subtitleTerminallyFailed: false,
  }

  it("stays incomplete until media is verified", () => {
    expect(resolveBundle({ ...base, mediaVerified: false })).toEqual({
      kind: "incomplete",
    })
  })

  it("completes with no subtitle requested", () => {
    expect(resolveBundle(base)).toEqual({
      kind: "downloaded",
      subtitleDegraded: false,
    })
  })

  it("completes cleanly when the requested subtitle verified", () => {
    expect(
      resolveBundle({
        ...base,
        subtitleRequested: true,
        subtitleVerified: true,
      }),
    ).toEqual({ kind: "downloaded", subtitleDegraded: false })
  })

  it("auto-degrades to no-subtitle when the chosen subtitle terminally failed", () => {
    expect(
      resolveBundle({
        ...base,
        subtitleRequested: true,
        subtitleTerminallyFailed: true,
      }),
    ).toEqual({ kind: "downloaded", subtitleDegraded: true })
  })

  it("stays incomplete while the requested subtitle is still pending", () => {
    expect(
      resolveBundle({
        ...base,
        subtitleRequested: true,
        subtitleVerified: false,
        subtitleTerminallyFailed: false,
      }),
    ).toEqual({ kind: "incomplete" })
  })
})
