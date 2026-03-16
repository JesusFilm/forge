import { createContext, useContext } from "react"

/**
 * Color scheme for section content, derived from the parent SectionWrapper's
 * background color.
 *
 * - `'dark'` → dark text on light background (default)
 * - `'light'` → light text on dark background
 */
export type ColorScheme = "light" | "dark"

export const SectionColorSchemeContext = createContext<ColorScheme>("dark")

export function useSectionColorScheme(): ColorScheme {
  return useContext(SectionColorSchemeContext)
}
