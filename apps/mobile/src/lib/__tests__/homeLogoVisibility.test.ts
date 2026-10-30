import {
  HOME_LOGO_HIDE_OFFSET,
  HOME_LOGO_TOP_TOLERANCE,
  nextHomeLogoHidden,
} from "../homeLogoVisibility"

/** Scrolls from the top through each offset; returns `hidden` after each one. */
function walk(offsets: number[]): boolean[] {
  let hidden = false
  return offsets.map((scrollY) => {
    hidden = nextHomeLogoHidden(hidden, scrollY)
    return hidden
  })
}

describe("nextHomeLogoHidden", () => {
  it("hides after 10pt and returns within 1pt of the top", () => {
    expect(HOME_LOGO_HIDE_OFFSET).toBe(10)
    expect(HOME_LOGO_TOP_TOLERANCE).toBe(1)
  })

  it("keeps the logo through a small scroll, then hides it past 10pt", () => {
    expect(walk([0, 5, 10, 10.5])).toEqual([false, false, false, true])
  })

  it("keeps the logo hidden while the feed scrolls up short of the top", () => {
    expect(walk([400, 200, 10, 5, 1])).toEqual([true, true, true, true, true])
  })

  it("brings the logo back at the top, including a sub-point rest offset", () => {
    expect(walk([400, 0])).toEqual([true, false])
    expect(walk([400, 0.33])).toEqual([true, false])
  })

  it("keeps the logo in place through pull-to-refresh and the top bounce", () => {
    expect(walk([-80, -20, 0])).toEqual([false, false, false])
    expect(walk([400, -30, 0])).toEqual([true, false, false])
  })
})
