import { homeRailRenderCount, isRailActive } from "./homeRailWindow"

describe("homeRailRenderCount", () => {
  it("starts Android with two rails and keeps two rows ahead of focus", () => {
    expect(homeRailRenderCount("android", 2, 0, 12)).toBe(2)
    expect(homeRailRenderCount("android", 2, 3, 12)).toBe(5)
  })

  it("retains mounted rails when focus returns upward", () => {
    expect(homeRailRenderCount("android", 8, 1, 12)).toBe(8)
  })

  it("caps a shrinking feed and preserves eager tvOS rails", () => {
    expect(homeRailRenderCount("android", 8, 10, 3)).toBe(3)
    expect(homeRailRenderCount("android", 2, 0, 0)).toBe(0)
    expect(homeRailRenderCount("ios", 2, 0, 12)).toBe(12)
  })
})

describe("isRailActive", () => {
  const BUFFER = 2

  it("mounts the focused row and its buffer neighbours", () => {
    // Focus on row 3, buffer 2 -> rows 1..5 active.
    expect(isRailActive(3, 3, BUFFER)).toBe(true)
    expect(isRailActive(1, 3, BUFFER)).toBe(true)
    expect(isRailActive(5, 3, BUFFER)).toBe(true)
  })

  it("leaves rows beyond the buffer inactive", () => {
    expect(isRailActive(6, 3, BUFFER)).toBe(false)
    // Real section-rail rowIndex (>= 1) below the window, not the hero row 0.
    expect(isRailActive(1, 4, BUFFER)).toBe(false)
  })

  it("mounts the top rails when focus rests on the hero (row 0)", () => {
    // Cold load: hero focused -> first two rails ready, third not.
    expect(isRailActive(1, 0, BUFFER)).toBe(true)
    expect(isRailActive(2, 0, BUFFER)).toBe(true)
    expect(isRailActive(3, 0, BUFFER)).toBe(false)
  })

  it("keeps the bottom rails active when focus drops to the mission tail", () => {
    // handleMissionFocus centers the window on the last rail (focusedRow = N).
    expect(isRailActive(8, 8, BUFFER)).toBe(true)
    expect(isRailActive(6, 8, BUFFER)).toBe(true)
    expect(isRailActive(5, 8, BUFFER)).toBe(false)
  })

  it("keeps at least the next rail's images warm in the travel direction (buffer >= 1)", () => {
    expect(isRailActive(4, 3, 1)).toBe(true)
    expect(isRailActive(2, 3, 1)).toBe(true)
    expect(isRailActive(5, 3, 1)).toBe(false)
  })
})
