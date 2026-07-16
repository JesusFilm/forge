import {
  reachabilityFromInterruption,
  type TransferInterruption,
} from "../downloadOutcome"

describe("reachabilityFromInterruption (R31)", () => {
  it.each<TransferInterruption>([
    { kind: "connectivity" },
    { kind: "backgroundedTransient" },
  ])("reads %p as offline", (interruption) => {
    expect(reachabilityFromInterruption(interruption)).toBe("offline")
  })

  it("reads a wifi-only-on-cellular pause as a network-restricted policy block", () => {
    expect(reachabilityFromInterruption({ kind: "wifiOnlyOnCellular" })).toBe(
      "network-restricted",
    )
  })

  it.each<TransferInterruption>([
    { kind: "httpError", status: 404 },
    { kind: "integrity" },
    { kind: "storageFull" },
    { kind: "userCancel" },
  ])(
    "returns null (no connectivity signal) for terminal/user cause %p",
    (i) => {
      expect(reachabilityFromInterruption(i)).toBeNull()
    },
  )
})
