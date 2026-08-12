import { describe, expect, it } from "vitest"

import { ruCardinal, ruOrdinalDay, ruSpokenReference } from "./ru-numbers"

describe("ruCardinal", () => {
  it("spells units, teens, tens, and hundreds", () => {
    expect(ruCardinal(1)).toBe("один")
    expect(ruCardinal(10)).toBe("десять")
    expect(ruCardinal(19)).toBe("девятнадцать")
    expect(ruCardinal(21)).toBe("двадцать один")
    expect(ruCardinal(176)).toBe("сто семьдесят шесть")
  })
  it("passes out-of-range values through as digits", () => {
    expect(ruCardinal(0)).toBe("0")
    expect(ruCardinal(500)).toBe("500")
  })
})

describe("ruOrdinalDay", () => {
  it("spells the day of month as a neuter ordinal", () => {
    expect(ruOrdinalDay(1)).toBe("первое")
    expect(ruOrdinalDay(17)).toBe("семнадцатое")
    expect(ruOrdinalDay(31)).toBe("тридцать первое")
  })
})

describe("ruSpokenReference", () => {
  it("spells a single-verse citation", () => {
    expect(ruSpokenReference("От Луки 19:10")).toBe(
      "От Луки, глава девятнадцать, стих десять",
    )
  })
  it("spells a verse range", () => {
    expect(ruSpokenReference("От Луки 8:22-25")).toBe(
      "От Луки, глава восемь, стихи двадцать два–двадцать пять",
    )
  })
  it("returns the input unchanged when it does not parse", () => {
    expect(ruSpokenReference("Псалом")).toBe("Псалом")
  })
})
