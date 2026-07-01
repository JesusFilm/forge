import { controlsForState } from "../downloadControls"

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

  it("failed → delete only", () => {
    expect(controlsForState("failed")).toEqual(["delete"])
  })

  it("canceled → no controls", () => {
    expect(controlsForState("canceled")).toEqual([])
  })
})
