import { compareIds, nameComparator } from "../collation"

const NAMES = ["English", "Русский", "Deutsch"]

describe("nameComparator (KTD15)", () => {
  it("orders names by the UI tag it gets, not by the device default", () => {
    // Russian collation puts Cyrillic before Latin; English puts it after.
    expect([...NAMES].sort(nameComparator("ru"))).toEqual([
      "Русский",
      "Deutsch",
      "English",
    ])
    expect([...NAMES].sort(nameComparator("en"))).toEqual([
      "Deutsch",
      "English",
      "Русский",
    ])
  })

  it("gives the same order for a fixed tag, whatever the input order", () => {
    const forward = [...NAMES].sort(nameComparator("ru"))
    const backward = [...NAMES].reverse().sort(nameComparator("ru"))
    expect(backward).toEqual(forward)
  })

  it("ignores case, as the lower-cased compare it replaces did", () => {
    expect(nameComparator("en")("english", "English")).toBe(0)
    expect(nameComparator("en")("a", "B")).toBeLessThan(0)
  })

  it("keeps accents apart", () => {
    expect(nameComparator("en")("e", "é")).not.toBe(0)
  })

  it("falls back to the default collation for a tag Intl refuses", () => {
    const compare = nameComparator("not a tag")
    expect([...NAMES].sort(compare)).toEqual([...NAMES].sort(compare))
    expect(compare("a", "b")).toBeLessThan(0)
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
