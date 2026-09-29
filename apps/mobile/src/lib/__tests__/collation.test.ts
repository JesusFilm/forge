import { compareIds, nameComparator } from "../collation"

const NAMES = ["English", "Русский", "Deutsch"]

describe("nameComparator (KTD15)", () => {
  it("orders names by the UI tag it gets, whatever the input order", () => {
    // Russian collation puts Cyrillic before Latin; English puts it after.
    for (const input of [NAMES, [...NAMES].reverse()]) {
      expect([...input].sort(nameComparator("ru"))).toEqual([
        "Русский",
        "Deutsch",
        "English",
      ])
    }
    expect([...NAMES].sort(nameComparator("en"))).toEqual([
      "Deutsch",
      "English",
      "Русский",
    ])
  })

  it("ignores case, as the lower-cased compare it replaces did", () => {
    expect(nameComparator("en")("english", "English")).toBe(0)
    expect(nameComparator("en")("a", "B")).toBeLessThan(0)
  })

  it("keeps accents apart", () => {
    expect(nameComparator("en")("e", "é")).not.toBe(0)
  })

  it("falls back to the default collation for a tag Intl refuses", () => {
    expect(nameComparator("not a tag")("a", "b")).toBeLessThan(0)
  })
})

describe("compareIds", () => {
  it("compares code units, so the order is the same in every language", () => {
    expect(["b", "a", "B", "ä"].sort(compareIds)).toEqual(["B", "a", "b", "ä"])
  })

  it("returns 0 only for equal ids", () => {
    expect(compareIds("ko", "ko")).toBe(0)
    expect(compareIds("ko", "ko-kmr")).toBeLessThan(0)
  })
})
