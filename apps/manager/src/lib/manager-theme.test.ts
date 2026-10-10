import { describe, expect, it } from "vitest"
import { MANAGER_THEME_INITIALIZER, resolveManagerTheme } from "./manager-theme"

describe("resolveManagerTheme", () => {
  it("prefers a saved light or dark choice", () => {
    expect(resolveManagerTheme("dark", false)).toBe("dark")
    expect(resolveManagerTheme("light", true)).toBe("light")
  })

  it("uses the operating-system preference on first visit", () => {
    expect(resolveManagerTheme(null, true)).toBe("dark")
    expect(resolveManagerTheme(null, false)).toBe("light")
  })

  it("ignores invalid stored values", () => {
    expect(resolveManagerTheme("sepia", true)).toBe("dark")
  })

  it.each([
    { stored: "dark", prefersDark: false, theme: "dark", source: "user" },
    { stored: "light", prefersDark: true, theme: "light", source: "user" },
    { stored: null, prefersDark: true, theme: "dark", source: "system" },
    { stored: "sepia", prefersDark: false, theme: "light", source: "system" },
  ])(
    "initializes $theme from a $source preference",
    ({ prefersDark, source, stored, theme }) => {
      const dataset: Record<string, string> = {}
      const initialize = new Function(
        "localStorage",
        "matchMedia",
        "document",
        MANAGER_THEME_INITIALIZER,
      )

      initialize({ getItem: () => stored }, () => ({ matches: prefersDark }), {
        documentElement: { dataset },
      })

      expect(dataset).toEqual({ theme, themeSource: source })
    },
  )

  it("uses the system preference when storage is unavailable", () => {
    const dataset: Record<string, string> = {}
    const initialize = new Function(
      "localStorage",
      "matchMedia",
      "document",
      MANAGER_THEME_INITIALIZER,
    )

    initialize(
      {
        getItem: () => {
          throw new Error("storage disabled")
        },
      },
      () => ({ matches: true }),
      { documentElement: { dataset } },
    )

    expect(dataset).toEqual({ theme: "dark", themeSource: "system" })
  })
})
