import {
  SectionNavContext,
  useSectionNav,
  type SectionNavValue,
} from "./SectionNavContext"

describe("SectionNavContext", () => {
  it("exports the context with noop defaults", () => {
    const ctx = SectionNavContext as unknown as {
      _currentValue: SectionNavValue
    }
    const defaults = ctx._currentValue
    expect(typeof defaults.scrollToSection).toBe("function")
    expect(typeof defaults.registerSectionRef).toBe("function")
    // noop functions should not throw
    expect(() => defaults.scrollToSection("test")).not.toThrow()
    expect(() => defaults.registerSectionRef("test", null)).not.toThrow()
  })

  it("exports useSectionNav hook as a function", () => {
    expect(typeof useSectionNav).toBe("function")
  })
})
