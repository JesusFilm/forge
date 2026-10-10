import { MIN_QUERY_LENGTH, meetsMinQueryLength } from "./searchGate"

describe("meetsMinQueryLength (typed-search gate)", () => {
  it("requires at least 3 trimmed characters", () => {
    expect(MIN_QUERY_LENGTH).toBe(3)
    expect(meetsMinQueryLength("")).toBe(false)
    expect(meetsMinQueryLength("j")).toBe(false)
    expect(meetsMinQueryLength("je")).toBe(false)
    expect(meetsMinQueryLength("jes")).toBe(true)
    expect(meetsMinQueryLength("jesus")).toBe(true)
  })

  it("trims before measuring (whitespace doesn't count toward the minimum)", () => {
    expect(meetsMinQueryLength("  a  ")).toBe(false)
    expect(meetsMinQueryLength(" ab ")).toBe(false)
    expect(meetsMinQueryLength(" abc ")).toBe(true)
  })
})
