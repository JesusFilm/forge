import { calculateWesternEaster, calculateOrthodoxEaster } from "./easterDates"

describe("calculateWesternEaster", () => {
  it.each([
    [2024, 3, 31], // March 31
    [2025, 4, 20], // April 20
    [2026, 4, 5], // April 5
    [2027, 3, 28], // March 28
    [2028, 4, 16], // April 16
  ])("returns correct date for %i", (year, month, day) => {
    const result = calculateWesternEaster(year)
    expect(result.getFullYear()).toBe(year)
    expect(result.getMonth()).toBe(month - 1)
    expect(result.getDate()).toBe(day)
  })
})

describe("calculateOrthodoxEaster", () => {
  it.each([
    [2024, 5, 5], // May 5
    [2025, 4, 20], // April 20
    [2026, 4, 12], // April 12
    [2027, 5, 2], // May 2
    [2028, 4, 16], // April 16
  ])("returns correct date for %i", (year, month, day) => {
    const result = calculateOrthodoxEaster(year)
    expect(result.getFullYear()).toBe(year)
    expect(result.getMonth()).toBe(month - 1)
    expect(result.getDate()).toBe(day)
  })
})
