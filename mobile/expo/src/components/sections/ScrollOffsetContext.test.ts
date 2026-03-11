import {
  ScrollOffsetContext,
  useScrollOffset,
  type ScrollOffsetValue,
} from "./ScrollOffsetContext"

describe("ScrollOffsetContext", () => {
  it("exports the context with default values", () => {
    const ctx = ScrollOffsetContext as { _currentValue: ScrollOffsetValue }
    const defaults = ctx._currentValue
    expect(defaults.scrollY).toBe(0)
    expect(defaults.viewportHeight).toBe(0)
  })

  it("exports useScrollOffset hook as a function", () => {
    expect(typeof useScrollOffset).toBe("function")
  })
})
