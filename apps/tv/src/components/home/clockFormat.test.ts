import { formatClock } from "./clockFormat"

describe("formatClock", () => {
  // Both edge paths of `% 12 || 12`: 0 and 12 each collapse to 12.
  it("formats midnight (00:00) as 12:00", () => {
    expect(formatClock(new Date(2026, 0, 1, 0, 0))).toBe("12:00")
  })

  it("formats noon (12:00) as 12:00", () => {
    expect(formatClock(new Date(2026, 0, 1, 12, 0))).toBe("12:00")
  })

  it("formats 1:30pm (13:30) as 1:30", () => {
    expect(formatClock(new Date(2026, 0, 1, 13, 30))).toBe("1:30")
  })

  it("pads a single-digit minute (09:05) to 9:05", () => {
    expect(formatClock(new Date(2026, 0, 1, 9, 5))).toBe("9:05")
  })

  it("formats an arbitrary PM time (21:47) as 9:47", () => {
    expect(formatClock(new Date(2026, 0, 1, 21, 47))).toBe("9:47")
  })
})
