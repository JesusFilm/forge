import { readOr, readSeconds, safely } from "../playerRead"

function released(): never {
  throw new Error("released")
}

describe("playerRead", () => {
  it("safely runs the action and swallows a released player's throw", () => {
    const action = jest.fn()
    safely(action)
    expect(action).toHaveBeenCalledTimes(1)
    expect(() => safely(released)).not.toThrow()
  })

  it("readOr returns the value, or the fallback when the read throws", () => {
    expect(readOr(() => true, false)).toBe(true)
    expect(readOr<boolean>(released, false)).toBe(false)
  })

  it("readSeconds keeps a finite time and maps a throw or a non-finite time to null", () => {
    expect(readSeconds(() => 12.5)).toBe(12.5)
    expect(readSeconds(() => 0)).toBe(0)
    expect(readSeconds(released)).toBeNull()
    expect(readSeconds(() => Number.NaN)).toBeNull()
    expect(readSeconds(() => Number.POSITIVE_INFINITY)).toBeNull()
  })
})
