import { isRailActive } from "./homeRailWindow"

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
    expect(isRailActive(0, 3, BUFFER)).toBe(false)
  })

  it("mounts the top rails when focus rests on the hero (row 0)", () => {
    // Cold load: hero focused -> first two rails ready, third not.
    expect(isRailActive(1, 0, BUFFER)).toBe(true)
    expect(isRailActive(2, 0, BUFFER)).toBe(true)
    expect(isRailActive(3, 0, BUFFER)).toBe(false)
  })

  it("always keeps at least the next rail ready in the travel direction (buffer >= 1)", () => {
    // The contract that prevents D-pad landing on an empty placeholder.
    expect(isRailActive(4, 3, 1)).toBe(true)
    expect(isRailActive(2, 3, 1)).toBe(true)
    expect(isRailActive(5, 3, 1)).toBe(false)
  })
})
