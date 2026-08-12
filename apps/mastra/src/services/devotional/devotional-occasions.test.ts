import { describe, expect, it } from "vitest"

import { occasionFor } from "./devotional-occasions"

describe("occasionFor", () => {
  it("returns the English occasion on a configured date", () => {
    expect(occasionFor("2026-08-19", "en")).toBe("World Humanitarian Day")
  })

  it("returns the Russian occasion on the same date", () => {
    expect(occasionFor("2026-08-19", "ru")).toBe(
      "Всемирный день гуманитарной помощи",
    )
  })

  it("is keyed by MM-DD, ignoring the year", () => {
    expect(occasionFor("2027-08-19", "en")).toBe("World Humanitarian Day")
  })

  it("returns null on a date with no configured occasion", () => {
    expect(occasionFor("2026-08-20", "en")).toBeNull()
    expect(occasionFor("2026-01-01", "ru")).toBeNull()
  })
})
