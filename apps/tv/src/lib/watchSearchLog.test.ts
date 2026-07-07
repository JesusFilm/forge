import {
  generateSearchRequestId,
  resolveWatchSearchOutcome,
} from "./watchSearchLog"

const V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe("resolveWatchSearchOutcome", () => {
  it("maps 0 results to no_result", () => {
    expect(resolveWatchSearchOutcome(0)).toBe("no_result")
  })
  it("maps a positive count to completed", () => {
    expect(resolveWatchSearchOutcome(5)).toBe("completed")
  })
})

describe("generateSearchRequestId", () => {
  it("returns a distinct RFC4122 v4 UUID each call", () => {
    const a = generateSearchRequestId()
    const b = generateSearchRequestId()
    expect(a).toMatch(V4)
    expect(b).toMatch(V4)
    expect(a).not.toBe(b)
  })

  it("uses the Math.random fallback shape when randomUUID is unavailable", () => {
    const spy = jest
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue(undefined as never)
    try {
      expect(generateSearchRequestId()).toMatch(V4)
    } finally {
      spy.mockRestore()
    }
  })
})
