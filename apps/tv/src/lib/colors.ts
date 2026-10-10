/** Crimson Gallery design tokens — single source of truth for the TV app. */
export const COLORS = {
  surface: "#161311",
  surfaceContainer: "#221F1D",
  surfaceContainerHigh: "#2D2927",
  surfaceContainerHighest: "#383432",
  primary: "#CB333B",
  text: "#F5F5F4",
  muted: "#A8A29E",
} as const

/**
 * Convert a hex color to rgba. Use instead of "transparent" in LinearGradient
 * colors arrays — "transparent" resolves to rgba(0,0,0,0) and dark-bands when
 * interpolating with non-black colors.
 * @see docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md
 */
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
