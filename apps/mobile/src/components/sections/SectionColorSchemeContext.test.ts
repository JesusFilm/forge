import {
  SectionColorSchemeContext,
  useSectionColorScheme,
  type ColorScheme,
} from "./SectionColorSchemeContext"

describe("SectionColorSchemeContext", () => {
  it("exports the context with 'dark' as default value", () => {
    // The context's default value is used when no Provider is above
    // We verify the exported default matches our expectation
    const ctx = SectionColorSchemeContext as { _currentValue: ColorScheme }
    const defaultValue: ColorScheme = ctx._currentValue
    expect(defaultValue).toBe("dark")
  })

  it("exports useSectionColorScheme hook as a function", () => {
    expect(typeof useSectionColorScheme).toBe("function")
  })

  it("ColorScheme type accepts valid values", () => {
    const light: ColorScheme = "light"
    const dark: ColorScheme = "dark"
    expect(light).toBe("light")
    expect(dark).toBe("dark")
  })
})
