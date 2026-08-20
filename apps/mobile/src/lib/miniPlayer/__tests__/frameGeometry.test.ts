import { frameGeometry } from "../layout"

/**
 * The host draws ONE frame, and this decides where it sits each render. The
 * cases that matter are the ordering ones: a render with no motion yet is the
 * gap between a slot detaching and the layout effect arming the shrink, and
 * what it returns is what the viewer sees for that frame.
 */

const PLAYER = { x: 0, y: 62, width: 440, height: 248 }
const CORNER = { x: 243, y: 757, width: 185, height: 104 }
const HELD = { x: 200, y: 700, width: 185, height: 104 }

describe("frameGeometry", () => {
  it("uses the attached slot's rect whenever a route owns the frame", () => {
    expect(
      frameGeometry({
        rect: PLAYER,
        motion: null,
        heldWindowFrame: null,
        departingRect: null,
        windowFrame: CORNER,
      }),
    ).toBe(PLAYER)
  })

  it("anchors a from-motion at its start and a to-motion at its end", () => {
    const motion = { from: PLAYER, to: CORNER, anchor: "from" as const }
    expect(
      frameGeometry({
        rect: null,
        motion,
        heldWindowFrame: null,
        departingRect: null,
        windowFrame: CORNER,
      }),
    ).toBe(PLAYER)
    expect(
      frameGeometry({
        rect: null,
        motion: { ...motion, anchor: "to" },
        heldWindowFrame: null,
        departingRect: null,
        windowFrame: CORNER,
      }),
    ).toBe(CORNER)
  })

  // REGRESSION GUARD. The slot detaches a full commit before the layout effect
  // arms the shrink. On that in-between render the frame fell through to the
  // corner, so the window painted already minimized (measured: the corner
  // region jumped to 122.7 then back to 74.3 on consecutive frames) and the
  // armed motion snapped it back to full size to begin shrinking.
  it("holds the departing rect on the render before the shrink is armed", () => {
    expect(
      frameGeometry({
        rect: null,
        motion: null,
        heldWindowFrame: null,
        departingRect: PLAYER,
        windowFrame: CORNER,
      }),
    ).toBe(PLAYER)
  })

  it("rests at the corner once the shrink has settled and released the rect", () => {
    // The effect nulls the departing rect as it arms the motion, so a settled
    // window has nothing to hold and belongs at its corner.
    expect(
      frameGeometry({
        rect: null,
        motion: null,
        heldWindowFrame: null,
        departingRect: null,
        windowFrame: CORNER,
      }),
    ).toBe(CORNER)
  })

  // An expand tap pins a committed base frame; that pin outranks the gap rect,
  // or a re-derived corner paints for a frame before the grow starts.
  it("lets a live expand hold outrank the departing rect", () => {
    expect(
      frameGeometry({
        rect: null,
        motion: null,
        heldWindowFrame: HELD,
        departingRect: PLAYER,
        windowFrame: CORNER,
      }),
    ).toBe(HELD)
  })

  it("prefers an in-flight motion over both the hold and the departing rect", () => {
    expect(
      frameGeometry({
        rect: null,
        motion: { from: PLAYER, to: CORNER, anchor: "from" },
        heldWindowFrame: HELD,
        departingRect: PLAYER,
        windowFrame: CORNER,
      }),
    ).toBe(PLAYER)
  })
})
