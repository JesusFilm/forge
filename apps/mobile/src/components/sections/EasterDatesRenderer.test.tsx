import {
  calculateWesternEaster,
  calculateOrthodoxEaster,
  calculatePassover,
} from "./EasterDatesRenderer"

/** Helper: format Date as YYYY-MM-DD for readable assertions. */
function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

describe("calculateWesternEaster", () => {
  // Authoritative dates from the U.S. Naval Observatory / timeanddate.com
  it.each([
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2028, "2028-04-16"],
  ])("year %i → %s", (year, expected) => {
    expect(fmt(calculateWesternEaster(year))).toBe(expected)
  })
})

describe("calculateOrthodoxEaster", () => {
  // Authoritative dates from the Ecumenical Patriarchate / timeanddate.com
  it.each([
    [2024, "2024-05-05"],
    [2025, "2025-04-20"],
    [2026, "2026-04-12"],
    [2027, "2027-05-02"],
    [2028, "2028-04-16"],
  ])("year %i → %s", (year, expected) => {
    expect(fmt(calculateOrthodoxEaster(year))).toBe(expected)
  })
})

describe("calculatePassover", () => {
  // Authoritative dates from hebcal.com (15 Nisan, first day of Pesach)
  it.each([
    [2024, "2024-04-23"],
    [2025, "2025-04-13"],
    [2026, "2026-04-02"],
    [2027, "2027-04-22"],
    [2028, "2028-04-11"],
  ])("year %i → %s", (year, expected) => {
    expect(fmt(calculatePassover(year))).toBe(expected)
  })
})
